process.env.JWT_SECRET = 'integration-secret-dashboard';
process.env.TOKEN_EXPIRES_IN = '1h';
process.env.CORS_ORIGIN = 'http://localhost:8083';
process.env.NODE_ENV = 'test';
process.env.ALLOWED_EMAIL_DOMAINS = 'softwareone.com';

jest.mock('../../src/models/User', () => require('../mocks/mongooseModel')());
jest.mock('../../src/models/Project', () => require('../mocks/mongooseModel')());
jest.mock('../../src/models/Document', () => require('../mocks/mongooseModel')());
jest.mock('../../src/models/Rule', () => require('../mocks/mongooseModel')());
jest.mock('../../src/models/Event', () => require('../mocks/mongooseModel')());
jest.mock('../../src/services/passwordService', () => {
  const actual = jest.requireActual('../../src/services/passwordService');
  return {
    ...actual,
    verifyPassword: jest.fn(),
    validatePasswordPolicy: jest.fn(),
    hashPassword: jest.fn(),
    generateProvisionalPassword: jest.fn()
  };
});
jest.mock('../../src/services/eventSourcingService', () => ({
  createEvent: jest.fn().mockResolvedValue({}),
  getProjectEvents: jest.fn(),
  getProjectTimeline: jest.fn()
}));

const request = require('supertest');
const { createApp } = require('../../src/app');
const User = require('../../src/models/User');
const Project = require('../../src/models/Project');
const Document = require('../../src/models/Document');
const Rule = require('../../src/models/Rule');
const { verifyPassword } = require('../../src/services/passwordService');

const app = createApp();

const READER_ID = '507f1f77bcf86cd799439011';
const WRITER_ID = '507f1f77bcf86cd799439012';
const NOBODY_ID = '507f1f77bcf86cd799439013';
const MINE_PROJECT = '507f1f77bcf86cd799439014';
const OTHER_PROJECT = '507f1f77bcf86cd799439015';
const MY_DOCUMENT = '507f1f77bcf86cd799439016';
const OTHER_DOCUMENT = '507f1f77bcf86cd799439017';

const YESTERDAY = new Date(Date.now() - 24 * 60 * 60 * 1000);

function makeUser(overrides = {}) {
  const data = {
    _id: NOBODY_ID,
    email: 'user@softwareone.com',
    passwordHash: '$2b$10$hash',
    active: true,
    mustChangePassword: true,
    permissions: [],
    provider: 'local',
    externalId: null,
    ...overrides
  };
  const user = {
    ...data,
    save: jest.fn(),
    toJSON() {
      const { passwordHash, save, toJSON, ...rest } = this;
      return rest;
    }
  };
  user.save.mockResolvedValue(user);
  return user;
}

function reader() {
  return makeUser({ _id: READER_ID, email: 'reader@softwareone.com', permissions: ['project:read'] });
}

function writer() {
  return makeUser({
    _id: WRITER_ID,
    email: 'writer@softwareone.com',
    permissions: ['project:read', 'project:write']
  });
}

async function loginAs(user) {
  User.findOne.mockResolvedValue(user);
  verifyPassword.mockResolvedValue(true);
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: user.email, password: 'RealPass1' })
    .expect(200);
  User.findById.mockResolvedValue(user);
  return res.headers['set-cookie'][0].split(';')[0];
}

/**
 * Mongoose devuelve una Query: se puede await (thenable) y encimasoporta encadenar .lean().
 * getStats resuelve ids con .lean() y getAlerts hace await y recorre el array, asi que el
 * mock tiene que servir para las dos formas de consumo.
 */
function asQuery(documents, leanResult) {
  return {
    lean: jest.fn().mockResolvedValue(leanResult),
    then: (resolve, reject) => Promise.resolve(documents).then(resolve, reject)
  };
}

/**
 * Monta el escenario que motiva la feature: dos proyectos, el lector participa en uno.
 * Un proyecto ajeno trae una regla vencida cuyo nombre es el dato que no debe filtrar.
 */
function seedTwoProjects() {
  Project.countDocuments.mockResolvedValue(2);
  Document.countDocuments.mockResolvedValue(1);
  Rule.countDocuments.mockResolvedValue(1);
  Document.find.mockReturnValue(
    asQuery([{ _id: MY_DOCUMENT, name: 'Documento propio', projectId: MINE_PROJECT }], [{ _id: MY_DOCUMENT }])
  );

  Project.find.mockImplementation((filter) => {
    if (filter.participants) {
      return asQuery(
        [{ _id: MINE_PROJECT, name: 'Proyecto propio', status: 'active', participants: [READER_ID] }],
        [{ _id: MINE_PROJECT }]
      );
    }
    return asQuery([
      { _id: MINE_PROJECT, name: 'Proyecto propio', status: 'active', participants: [READER_ID] },
      { _id: OTHER_PROJECT, name: 'Proyecto ajeno', status: 'active', participants: [NOBODY_ID] }
    ]);
  });
  // Mongo solo devolveria la regla ajena si su documento fuera consultado: el mock respeta
  // ese contrato, asi que el test mide el recorte en cascada y no la generosidad del mock.
  Rule.find.mockImplementation((filter) => {
    const owns = String(filter.documentId) === String(OTHER_DOCUMENT);
    return Promise.resolve(
      owns
        ? [{ _id: 'r-ajena', name: 'REGLA SECRETA ajena', documentId: OTHER_DOCUMENT, deadline: YESTERDAY, required: true }]
        : []
    );
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  User.create = jest.fn();
});

// Los tres casos que pide el AC6 de feature_list.json.
describe('authorization on the dashboard routes', () => {
  test('returns 401 without a session on both routes', async () => {
    await request(app).get('/api/dashboard/stats').expect(401);
    await request(app).get('/api/dashboard/alerts').expect(401);
  });

  test('returns 403 project:read for a user with no project permissions', async () => {
    const cookie = await loginAs(makeUser({ permissions: [] }));

    const stats = await request(app).get('/api/dashboard/stats').set('Cookie', cookie).expect(403);
    const alerts = await request(app).get('/api/dashboard/alerts').set('Cookie', cookie).expect(403);

    expect(stats.body.error.code).toBe('FORBIDDEN');
    expect(stats.body.error.message).toBe('Permiso requerido: project:read');
    expect(alerts.body.error.code).toBe('FORBIDDEN');
  });

  test('returns 403 for a user whose only permission is another module', async () => {
    const cookie = await loginAs(makeUser({ permissions: ['document:read'] }));

    await request(app).get('/api/dashboard/stats').set('Cookie', cookie).expect(403);
    await request(app).get('/api/dashboard/alerts').set('Cookie', cookie).expect(403);
  });
});

describe('stats scoping', () => {
  test('a reader sees only the counters of the projects they participate in', async () => {
    const cookie = await loginAs(reader());
    seedTwoProjects();

    const res = await request(app).get('/api/dashboard/stats').set('Cookie', cookie).expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.totalProjects).toBe(2);
    // El documento ajeno no esta en el conjunto resuelto, asi que no se cuenta.
    expect(res.body.data.totalDocuments).toBe(1);
    expect(Project.find).toHaveBeenCalledWith({ participants: READER_ID }, '_id');
    expect(Document.find).toHaveBeenCalledWith({ projectId: { $in: [MINE_PROJECT] } }, '_id');
  });

  test('a reader with no visible project gets zeroes and the full shape, never $in: []', async () => {
    const cookie = await loginAs(reader());
    Project.countDocuments.mockResolvedValue(0);
    Document.countDocuments.mockResolvedValue(0);
    Rule.countDocuments.mockResolvedValue(0);
    Project.find.mockReturnValue(asQuery([], []));

    const res = await request(app).get('/api/dashboard/stats').set('Cookie', cookie).expect(200);

    expect(res.body.data).toEqual({
      totalProjects: 0,
      activeProjects: 0,
      completedProjects: 0,
      pausedProjects: 0,
      totalDocuments: 0,
      totalRules: 0,
      completedRules: 0,
      pendingRules: 0,
      projectsByPriority: { alta: 0, media: 0, baja: 0 }
    });
    expect(Rule.countDocuments).not.toHaveBeenCalled();
  });

  test('a writer keeps the global view and never resolves ids', async () => {
    const cookie = await loginAs(writer());
    Project.countDocuments
      .mockResolvedValueOnce(9).mockResolvedValueOnce(4).mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1).mockResolvedValueOnce(3).mockResolvedValueOnce(4)
      .mockResolvedValueOnce(2);
    Document.countDocuments.mockResolvedValue(30);
    Rule.countDocuments.mockResolvedValueOnce(60).mockResolvedValueOnce(30).mockResolvedValueOnce(30);

    const res = await request(app).get('/api/dashboard/stats').set('Cookie', cookie).expect(200);

    expect(res.body.data).toEqual({
      totalProjects: 9, activeProjects: 4, completedProjects: 2, pausedProjects: 1,
      totalDocuments: 30, totalRules: 60, completedRules: 30, pendingRules: 30,
      projectsByPriority: { alta: 3, media: 4, baja: 2 }
    });
    expect(Project.find).not.toHaveBeenCalled();
    expect(Document.find).not.toHaveBeenCalled();
  });
});

describe('alerts scoping', () => {
  test('a reader never receives the name of a project they do not participate in', async () => {
    const cookie = await loginAs(reader());
    seedTwoProjects();

    const res = await request(app).get('/api/dashboard/alerts').set('Cookie', cookie).expect(200);

    expect(res.body.success).toBe(true);
    expect(Project.find).toHaveBeenCalledWith({
      status: { $ne: 'unavailable' },
      participants: READER_ID
    });
    const payload = JSON.stringify(res.body);
    expect(payload).not.toContain('Proyecto ajeno');
    expect(payload).not.toContain('Documento ajeno');
    expect(payload).not.toContain('REGLA SECRETA ajena');
  });

  test('a writer does receive the global alerts, foreign projects included', async () => {
    const cookie = await loginAs(writer());
    Project.find.mockResolvedValue([
      { _id: MINE_PROJECT, name: 'Proyecto propio', status: 'active', participants: [READER_ID] },
      { _id: OTHER_PROJECT, name: 'Proyecto ajeno', status: 'active', participants: [NOBODY_ID] }
    ]);
    Document.find.mockResolvedValue([
      { _id: OTHER_DOCUMENT, name: 'Documento ajeno', projectId: OTHER_PROJECT }
    ]);
    Rule.find.mockResolvedValue([
      { _id: 'r-ajena', name: 'REGLA SECRETA ajena', documentId: OTHER_DOCUMENT, deadline: YESTERDAY, required: true }
    ]);

    const res = await request(app).get('/api/dashboard/alerts').set('Cookie', cookie).expect(200);

    const payload = JSON.stringify(res.body);
    expect(payload).toContain('Proyecto ajeno');
    expect(Project.find).toHaveBeenCalledWith({ status: { $ne: 'unavailable' } });
  });

  test('the days parameter keeps working for a scoped reader', async () => {
    const cookie = await loginAs(reader());
    Project.find.mockReturnValue(asQuery([], []));

    const res = await request(app).get('/api/dashboard/alerts?days=30').set('Cookie', cookie).expect(200);

    expect(res.body.data.overdue).toEqual([]);
    expect(res.body.data.upcoming).toEqual([]);
  });
});
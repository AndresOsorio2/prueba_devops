process.env.JWT_SECRET = 'integration-secret-membership';
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
const WRITER_ID = '507f1f77bcf86cd799439010';
const MEMBER_ID = '507f1f77bcf86cd799439011';
const OTHER_ID = '507f1f77bcf86cd799439012';
const PROJECT_ID = '507f1f77bcf86cd799439013';
const EMAIL = 'user@softwareone.com';

function makeUser(overrides = {}) {
  const data = {
    _id: WRITER_ID,
    email: EMAIL,
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

function baseWriter() {
  return makeUser({ permissions: ['project:write'] });
}

async function loginAs(user) {
  User.findOne.mockResolvedValue(user);
  verifyPassword.mockResolvedValue(true);
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: user.email, password: 'RealPass1' })
    .expect(200);
  return res.headers['set-cookie'][0].split(';')[0];
}

async function writerSession() {
  const cookie = await loginAs(baseWriter());
  User.findById.mockResolvedValue(baseWriter());
  return cookie;
}

beforeEach(() => {
  jest.clearAllMocks();
  User.create = jest.fn();
  Document.find.mockResolvedValue([]);
  Rule.countDocuments.mockResolvedValue(0);
});

describe('authentication on the participant routes', () => {
  test('returns 401 without a session', async () => {
    await request(app)
      .post(`/api/projects/${PROJECT_ID}/participants`)
      .send({ userIds: [MEMBER_ID] })
      .expect(401);
    await request(app)
      .delete(`/api/projects/${PROJECT_ID}/participants/${MEMBER_ID}`)
      .expect(401);
  });
});

describe('authorization with project:write on the participant routes', () => {
  test('returns 403 for a user without project:write', async () => {
    const viewer = makeUser({ _id: MEMBER_ID, email: 'viewer@softwareone.com', permissions: ['project:read'] });
    const cookie = await loginAs(viewer);
    User.findById.mockResolvedValue(viewer);

    const postRes = await request(app)
      .post(`/api/projects/${PROJECT_ID}/participants`)
      .set('Cookie', cookie)
      .send({ userIds: [MEMBER_ID] })
      .expect(403);
    const deleteRes = await request(app)
      .delete(`/api/projects/${PROJECT_ID}/participants/${MEMBER_ID}`)
      .set('Cookie', cookie)
      .expect(403);

    expect(postRes.body.error.code).toBe('FORBIDDEN');
    expect(deleteRes.body.error.code).toBe('FORBIDDEN');
  });
});

describe('POST /api/projects/:id/participants', () => {
  test('adds multiple userIds avoiding duplicates and responds 200 with the updated list', async () => {
    const cookie = await writerSession();
    const project = new Project({ participants: [MEMBER_ID] });
    Project.findById.mockResolvedValue(project);

    const res = await request(app)
      .post(`/api/projects/${PROJECT_ID}/participants`)
      .set('Cookie', cookie)
      .send({ userIds: [MEMBER_ID, OTHER_ID, MEMBER_ID] })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.participants).toEqual([MEMBER_ID, OTHER_ID]);
    expect(project.save).toHaveBeenCalledTimes(1);
  });

  test('returns 400 VALIDATION_ERROR for a missing array or an invalid ObjectId', async () => {
    const cookie = await writerSession();

    const missing = await request(app)
      .post(`/api/projects/${PROJECT_ID}/participants`)
      .set('Cookie', cookie)
      .send({})
      .expect(400);
    const invalid = await request(app)
      .post(`/api/projects/${PROJECT_ID}/participants`)
      .set('Cookie', cookie)
      .send({ userIds: ['not-an-id'] })
      .expect(400);

    expect(missing.body.error.code).toBe('VALIDATION_ERROR');
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
    expect(Project.findById).not.toHaveBeenCalled();
  });

  test('returns 404 when the project does not exist', async () => {
    const cookie = await writerSession();
    Project.findById.mockResolvedValue(null);

    const res = await request(app)
      .post(`/api/projects/${PROJECT_ID}/participants`)
      .set('Cookie', cookie)
      .send({ userIds: [MEMBER_ID] })
      .expect(404);

    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('DELETE /api/projects/:id/participants/:userId', () => {
  test('removes the participant and responds 200 with the updated list', async () => {
    const cookie = await writerSession();
    const project = new Project({ participants: [MEMBER_ID, OTHER_ID] });
    Project.findById.mockResolvedValue(project);

    const res = await request(app)
      .delete(`/api/projects/${PROJECT_ID}/participants/${MEMBER_ID}`)
      .set('Cookie', cookie)
      .expect(200);

    expect(res.body.data.participants).toEqual([OTHER_ID]);
    expect(project.save).toHaveBeenCalledTimes(1);
  });

  test('returns 400 for an invalid userId and 404 for a missing project', async () => {
    const cookie = await writerSession();

    const invalid = await request(app)
      .delete(`/api/projects/${PROJECT_ID}/participants/not-an-id`)
      .set('Cookie', cookie)
      .expect(400);

    Project.findById.mockResolvedValue(null);
    const notFound = await request(app)
      .delete(`/api/projects/${PROJECT_ID}/participants/${MEMBER_ID}`)
      .set('Cookie', cookie)
      .expect(404);

    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
    expect(notFound.body.error.code).toBe('NOT_FOUND');
  });
});

describe('GET /api/projects visibility', () => {
  function mockProjectFind(projects) {
    Project.find.mockReturnValue({ sort: jest.fn().mockResolvedValue(projects) });
  }

  test('returns all projects to a user with project:write', async () => {
    const cookie = await writerSession();
    const project = new Project({ participants: [OTHER_ID] });
    mockProjectFind([project]);

    const res = await request(app).get('/api/projects').set('Cookie', cookie).expect(200);

    expect(Project.find).toHaveBeenCalledWith({});
    expect(res.body.data).toHaveLength(1);
  });

  test('returns only assigned projects to a user with project:read', async () => {
    const viewer = makeUser({ _id: MEMBER_ID, email: 'viewer@softwareone.com', permissions: ['project:read'] });
    const cookie = await loginAs(viewer);
    User.findById.mockResolvedValue(viewer);
    const assigned = new Project({ participants: [MEMBER_ID] });
    const notAssigned = new Project({ participants: [OTHER_ID] });
    mockProjectFind([assigned, notAssigned]);

    const res = await request(app).get('/api/projects').set('Cookie', cookie).expect(200);

    expect(Project.find).toHaveBeenCalledWith({ participants: MEMBER_ID });
    expect(res.body.data).toHaveLength(2);
  });
});

describe('GET /api/projects/:id visibility', () => {
  test('returns the project to a writer that is not a participant', async () => {
    const cookie = await writerSession();
    const project = new Project({ participants: [OTHER_ID] });
    Project.findById.mockResolvedValue(project);
    Document.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([]) });

    const res = await request(app).get(`/api/projects/${PROJECT_ID}`).set('Cookie', cookie).expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data._id).toBeDefined();
  });

  test('returns 403 for a project a participant-less reader does not belong to', async () => {
    const viewer = makeUser({ _id: MEMBER_ID, email: 'viewer@softwareone.com', permissions: ['project:read'] });
    const cookie = await loginAs(viewer);
    User.findById.mockResolvedValue(viewer);
    Project.findById.mockResolvedValue(new Project({ participants: [OTHER_ID] }));

    const res = await request(app).get(`/api/projects/${PROJECT_ID}`).set('Cookie', cookie).expect(403);

    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  test('returns the project to a participant without project:write', async () => {
    const viewer = makeUser({ _id: MEMBER_ID, email: 'viewer@softwareone.com', permissions: ['project:read'] });
    const cookie = await loginAs(viewer);
    User.findById.mockResolvedValue(viewer);
    Project.findById.mockResolvedValue(new Project({ participants: [MEMBER_ID, OTHER_ID] }));
    Document.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([]) });

    const res = await request(app).get(`/api/projects/${PROJECT_ID}`).set('Cookie', cookie).expect(200);

    expect(res.body.data.participants).toContain(MEMBER_ID);
  });

  test('returns 404 when the project does not exist', async () => {
    const cookie = await writerSession();
    Project.findById.mockResolvedValue(null);

    const res = await request(app).get(`/api/projects/${PROJECT_ID}`).set('Cookie', cookie).expect(404);

    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
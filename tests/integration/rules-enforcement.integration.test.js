process.env.JWT_SECRET = 'integration-secret-rules';
process.env.TOKEN_EXPIRES_IN = '1h';
process.env.CORS_ORIGIN = 'http://localhost:8083';
process.env.NODE_ENV = 'test';
process.env.ALLOWED_EMAIL_DOMAINS = 'softwareone.com';

jest.mock('../../src/models/User', () => require('../mocks/mongooseModel')());
jest.mock('../../src/models/Project', () => require('../mocks/mongooseModel')());
jest.mock('../../src/models/Document', () => require('../mocks/mongooseModel')());
jest.mock('../../src/models/Rule', () => require('../mocks/mongooseModel')());
jest.mock('../../src/models/Evidence', () => require('../mocks/mongooseModel')());
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
const Evidence = require('../../src/models/Evidence');
const { verifyPassword } = require('../../src/services/passwordService');
const { createEvent } = require('../../src/services/eventSourcingService');

const app = createApp();
const WRITER_ID = '507f1f77bcf86cd799439020';
const READER_ID = '507f1f77bcf86cd799439021';
const OTHER_ID = '507f1f77bcf86cd799439022';
const PROJECT_ID = '507f1f77bcf86cd799439023';
const DOCUMENT_ID = '507f1f77bcf86cd799439024';
const RULE_ID = '507f1f77bcf86cd799439025';
const SUB_RULE_ID = '507f1f77bcf86cd799439026';
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
  return makeUser({ permissions: ['project:write', 'rule:read', 'rule:write'] });
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

function mockDocumentDetail(status = 'pending') {
  return new Document({ _id: DOCUMENT_ID, name: 'Assessment', description: 'desc', projectId: PROJECT_ID, status });
}

function mockRule(overrides = {}) {
  return new Rule({ _id: RULE_ID, documentId: DOCUMENT_ID, parentId: null, name: 'Rule 1', status: 'pending', ...overrides });
}

function queryResult(data) {
  const promise = Promise.resolve(data);
  return { sort: jest.fn().mockReturnValue(promise), then: promise.then.bind(promise) };
}

beforeEach(() => {
  jest.clearAllMocks();
  User.create = jest.fn();
  Project.findById.mockResolvedValue(new Project({ participants: [] }));
  Document.findById.mockResolvedValue(mockDocumentDetail());
  Rule.find.mockReturnValue(queryResult([]));
  Rule.countDocuments.mockResolvedValue(0);
  Evidence.deleteMany.mockResolvedValue({ deletedCount: 0 });
  Rule.deleteMany.mockResolvedValue({ deletedCount: 0 });
});

describe('authentication on the rule routes', () => {
  test('returns 401 without a session on every route', async () => {
    await request(app).get(`/api/documents/${DOCUMENT_ID}/rules`).expect(401);
    await request(app).post(`/api/documents/${DOCUMENT_ID}/rules`).send({}).expect(401);
    await request(app).get(`/api/rules/${RULE_ID}`).expect(401);
    await request(app).put(`/api/rules/${RULE_ID}`).send({}).expect(401);
    await request(app).patch(`/api/rules/${RULE_ID}/status`).send({}).expect(401);
    await request(app).delete(`/api/rules/${RULE_ID}`).expect(401);
  });
});

describe('module permission on the rule routes', () => {
  test('returns 403 rule:read for a user without rule permissions', async () => {
    const viewer = makeUser({ _id: OTHER_ID, email: 'viewer@softwareone.com', permissions: ['project:read'] });
    const cookie = await loginAs(viewer);

    const res = await request(app)
      .get(`/api/documents/${DOCUMENT_ID}/rules`)
      .set('Cookie', cookie)
      .expect(403);

    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(res.body.error.message).toBe('Permiso requerido: rule:read');
    expect(Document.findById).not.toHaveBeenCalled();
  });

  test('returns 403 rule:write on write routes for a reader-only user', async () => {
    const reader = makeUser({ _id: READER_ID, email: 'reader@softwareone.com', permissions: ['rule:read'] });
    const cookie = await loginAs(reader);
    Rule.findById.mockResolvedValue(mockRule());

    const postRes = await request(app)
      .post(`/api/documents/${DOCUMENT_ID}/rules`)
      .set('Cookie', cookie)
      .send({ name: 'Nueva' })
      .expect(403);
    const putRes = await request(app)
      .put(`/api/rules/${RULE_ID}`)
      .set('Cookie', cookie)
      .send({ name: 'Updated' })
      .expect(403);
    const statusRes = await request(app)
      .patch(`/api/rules/${RULE_ID}/status`)
      .set('Cookie', cookie)
      .send({ status: 'done' })
      .expect(403);
    const delRes = await request(app)
      .delete(`/api/rules/${RULE_ID}`)
      .set('Cookie', cookie)
      .expect(403);

    expect(postRes.body.error.message).toBe('Permiso requerido: rule:write');
    expect(putRes.body.error.message).toBe('Permiso requerido: rule:write');
    expect(statusRes.body.error.message).toBe('Permiso requerido: rule:write');
    expect(delRes.body.error.message).toBe('Permiso requerido: rule:write');
  });
});

describe('project participation control on the rule routes', () => {
  test('returns 403 for a non-participant reader listing rules', async () => {
    const reader = makeUser({ _id: READER_ID, email: 'reader@softwareone.com', permissions: ['rule:read'] });
    const cookie = await loginAs(reader);
    Project.findById.mockResolvedValue(new Project({ participants: [OTHER_ID] }));

    const res = await request(app)
      .get(`/api/documents/${DOCUMENT_ID}/rules`)
      .set('Cookie', cookie)
      .expect(403);

    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(res.body.error.message).toBe('No eres participante del proyecto');
    expect(Rule.find).not.toHaveBeenCalled();
  });

  test('returns 403 for a non-participant reader on a single rule', async () => {
    const reader = makeUser({ _id: READER_ID, email: 'reader@softwareone.com', permissions: ['rule:read'] });
    const cookie = await loginAs(reader);
    Rule.findById.mockResolvedValue(mockRule());
    Project.findById.mockResolvedValue(new Project({ participants: [OTHER_ID] }));

    const res = await request(app)
      .get(`/api/rules/${RULE_ID}`)
      .set('Cookie', cookie)
      .expect(403);

    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(res.body.error.message).toBe('No eres participante del proyecto');
  });

  test('returns 403 for a non-participant on write routes', async () => {
    const reader = makeUser({ _id: READER_ID, email: 'reader@softwareone.com', permissions: ['rule:read', 'rule:write'] });
    const cookie = await loginAs(reader);
    Rule.findById.mockResolvedValue(mockRule());
    Project.findById.mockResolvedValue(new Project({ participants: [OTHER_ID] }));

    const putRes = await request(app)
      .put(`/api/rules/${RULE_ID}`)
      .set('Cookie', cookie)
      .send({ name: 'Updated' })
      .expect(403);
    const statusRes = await request(app)
      .patch(`/api/rules/${RULE_ID}/status`)
      .set('Cookie', cookie)
      .send({ status: 'done' })
      .expect(403);
    const delRes = await request(app)
      .delete(`/api/rules/${RULE_ID}`)
      .set('Cookie', cookie)
      .expect(403);

    expect(putRes.body.error.message).toBe('No eres participante del proyecto');
    expect(statusRes.body.error.message).toBe('No eres participante del proyecto');
    expect(delRes.body.error.message).toBe('No eres participante del proyecto');
    expect(Rule.deleteMany).not.toHaveBeenCalled();
  });

  test('allows a participant reader to list rules and read a single rule', async () => {
    const reader = makeUser({ _id: READER_ID, email: 'reader@softwareone.com', permissions: ['rule:read'] });
    const cookie = await loginAs(reader);
    Project.findById.mockResolvedValue(new Project({ participants: [READER_ID] }));
    Rule.findById.mockResolvedValue(mockRule());

    const listRes = await request(app)
      .get(`/api/documents/${DOCUMENT_ID}/rules`)
      .set('Cookie', cookie)
      .expect(200);

    expect(listRes.body.success).toBe(true);
    expect(listRes.body.data).toEqual([]);

    const singleRes = await request(app)
      .get(`/api/rules/${RULE_ID}`)
      .set('Cookie', cookie)
      .expect(200);

    expect(singleRes.body.data.name).toBe('Rule 1');
  });

  test('applies the same participation check for a nested sub-rule', async () => {
    const outsider = makeUser({ _id: OTHER_ID, email: 'outsider@softwareone.com', permissions: ['rule:read'] });
    const cookieOutsider = await loginAs(outsider);
    const subRule = mockRule({ _id: SUB_RULE_ID, parentId: RULE_ID, name: 'Grandchild' });
    Rule.findById.mockResolvedValue(subRule);
    Project.findById.mockResolvedValue(new Project({ participants: [READER_ID] }));

    const denied = await request(app)
      .get(`/api/rules/${SUB_RULE_ID}`)
      .set('Cookie', cookieOutsider)
      .expect(403);

    expect(denied.body.error.message).toBe('No eres participante del proyecto');

    const participant = makeUser({ _id: READER_ID, email: 'reader@softwareone.com', permissions: ['rule:read'] });
    const cookieParticipant = await loginAs(participant);

    const allowed = await request(app)
      .get(`/api/rules/${SUB_RULE_ID}`)
      .set('Cookie', cookieParticipant)
      .expect(200);

    expect(allowed.body.data._id).toBe(SUB_RULE_ID);
    expect(allowed.body.data.children).toEqual([]);
  });
});

describe('not found handling on the rule routes', () => {
  test('returns 404 NOT_FOUND for a missing rule', async () => {
    const cookie = await loginAs(baseWriter());
    Rule.findById.mockResolvedValue(null);

    const res = await request(app)
      .get(`/api/rules/${RULE_ID}`)
      .set('Cookie', cookie)
      .expect(404);

    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.message).toBe('Rule not found');
  });

  test('returns 404 when the owning document of a rule does not exist', async () => {
    const cookie = await loginAs(baseWriter());
    Rule.findById.mockResolvedValue(mockRule());
    Document.findById.mockResolvedValue(null);

    const res = await request(app)
      .get(`/api/rules/${RULE_ID}`)
      .set('Cookie', cookie)
      .expect(404);

    expect(res.body.error.message).toBe('Document not found');
  });

  test('returns 404 when the owning project of a document does not exist', async () => {
    const cookie = await loginAs(baseWriter());
    Project.findById.mockResolvedValue(null);

    const res = await request(app)
      .get(`/api/documents/${DOCUMENT_ID}/rules`)
      .set('Cookie', cookie)
      .expect(404);

    expect(res.body.error.message).toBe('Project not found');
  });
});

describe('project:write exemption and functional flows on the rule routes', () => {
  test('allows a project:write writer to create a rule without being a participant', async () => {
    const cookie = await loginAs(baseWriter());
    Project.findById.mockResolvedValue(new Project({ status: 'active', participants: [] }));
    Document.findById.mockResolvedValue(new Document({ _id: DOCUMENT_ID, status: 'in_progress', projectId: PROJECT_ID }));

    const res = await request(app)
      .post(`/api/documents/${DOCUMENT_ID}/rules`)
      .set('Cookie', cookie)
      .send({ name: 'Nueva Regla', type: 'text', required: true })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('Nueva Regla');
    expect(res.body.data.documentId).toBe(DOCUMENT_ID);
    expect(createEvent).toHaveBeenCalledWith('rule_created', expect.any(Object), expect.objectContaining({ projectId: PROJECT_ID, documentId: DOCUMENT_ID }));
  });

  test('allows a project:write writer to update, change status and delete a rule', async () => {
    const cookie = await loginAs(baseWriter());
    const rule = mockRule();
    rule.save = jest.fn().mockResolvedValue(rule);
    Rule.findById.mockResolvedValue(rule);
    Project.findById.mockResolvedValue(new Project({ status: 'active', participants: [] }));

    const putRes = await request(app)
      .put(`/api/rules/${RULE_ID}`)
      .set('Cookie', cookie)
      .send({ name: 'Updated' })
      .expect(200);

    const statusRes = await request(app)
      .patch(`/api/rules/${RULE_ID}/status`)
      .set('Cookie', cookie)
      .send({ status: 'in_progress' })
      .expect(200);

    const delRes = await request(app)
      .delete(`/api/rules/${RULE_ID}`)
      .set('Cookie', cookie)
      .expect(200);

    expect(putRes.body.data.name).toBe('Updated');
    expect(statusRes.body.data.status).toBe('in_progress');
    expect(delRes.body.data._id).toBe(RULE_ID);
    expect(createEvent).toHaveBeenCalledWith('rule_deleted', expect.any(Object), expect.objectContaining({ projectId: PROJECT_ID, documentId: DOCUMENT_ID }));
  });

  test('blocks modifications on completed documents and completed rules', async () => {
    const cookie = await loginAs(baseWriter());
    Document.findById.mockResolvedValue(new Document({ _id: DOCUMENT_ID, status: 'done', projectId: PROJECT_ID }));
    const rule = mockRule({ status: 'done' });
    rule.save = jest.fn().mockResolvedValue(rule);
    Rule.findById.mockResolvedValue(rule);

    const postRes = await request(app)
      .post(`/api/documents/${DOCUMENT_ID}/rules`)
      .set('Cookie', cookie)
      .send({ name: 'Nueva' })
      .expect(400);
    const putRes = await request(app)
      .put(`/api/rules/${RULE_ID}`)
      .set('Cookie', cookie)
      .send({ name: 'Updated' })
      .expect(400);
    const delRes = await request(app)
      .delete(`/api/rules/${RULE_ID}`)
      .set('Cookie', cookie)
      .expect(400);

    expect(postRes.body.error.code).toBe('DOCUMENT_COMPLETED');
    expect(putRes.body.error.code).toBe('RULE_COMPLETED');
    expect(delRes.body.error.code).toBe('RULE_COMPLETED');
  });
});
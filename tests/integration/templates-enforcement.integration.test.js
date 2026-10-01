process.env.JWT_SECRET = 'integration-secret-templates';
process.env.TOKEN_EXPIRES_IN = '1h';
process.env.CORS_ORIGIN = 'http://localhost:8083';
process.env.NODE_ENV = 'test';
process.env.ALLOWED_EMAIL_DOMAINS = 'softwareone.com';

jest.mock('../../src/models/User', () => require('../mocks/mongooseModel')());
jest.mock('../../src/models/Project', () => require('../mocks/mongooseModel')());
jest.mock('../../src/models/Document', () => require('../mocks/mongooseModel')());
jest.mock('../../src/models/Rule', () => require('../mocks/mongooseModel')());
jest.mock('../../src/models/Event', () => require('../mocks/mongooseModel')());
jest.mock('../../src/models/Template', () => require('../mocks/mongooseModel')());
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
jest.mock('../../src/services/reportService', () => ({
  generateDocumentReportMarkdown: jest.fn()
}));
jest.mock('../../src/services/aiReportService', () => ({
  generateDocumentSection: jest.fn()
}));
jest.mock('../../src/services/templateService', () => ({
  buildItemsFromRules: jest.fn(),
  saveTemplateFromSnapshot: jest.fn(),
  materializeTemplateItems: jest.fn()
}));

const request = require('supertest');
const { createApp } = require('../../src/app');
const User = require('../../src/models/User');
const Project = require('../../src/models/Project');
const Document = require('../../src/models/Document');
const Template = require('../../src/models/Template');
const { verifyPassword } = require('../../src/services/passwordService');
const templateService = require('../../src/services/templateService');

const app = createApp();
const WRITER_ID = '507f1f77bcf86cd799439020';
const READER_ID = '507f1f77bcf86cd799439021';
const OTHER_ID = '507f1f77bcf86cd799439022';
const PROJECT_ID = '507f1f77bcf86cd799439023';
const DOCUMENT_ID = '507f1f77bcf86cd799439024';
const TEMPLATE_ID = '507f1f77bcf86cd799439025';
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

function templateWriter() {
  return makeUser({ permissions: ['project:write', 'document:read', 'document:write', 'template:read', 'template:write'] });
}

function templateReader() {
  return makeUser({ _id: READER_ID, email: 'reader@softwareone.com', permissions: ['template:read'] });
}

function noTemplatePermission() {
  return makeUser({ _id: OTHER_ID, email: 'viewer@softwareone.com', permissions: ['project:read', 'document:write'] });
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

function mockTemplate() {
  return new Template({ _id: TEMPLATE_ID, name: 'Assessment', description: 'desc', items: [] });
}

beforeEach(() => {
  jest.clearAllMocks();
  User.create = jest.fn();
  Project.findById.mockResolvedValue(new Project({ participants: [] }));
  Document.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([]) });
  Document.countDocuments.mockResolvedValue(0);
  Template.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([]) });
});

describe('authentication on the templates routes', () => {
  test('returns 401 without a session on every route', async () => {
    await request(app).get('/api/templates').expect(401);
    await request(app).get(`/api/templates/${TEMPLATE_ID}`).expect(401);
    await request(app).post('/api/templates').send({}).expect(401);
    await request(app).put(`/api/templates/${TEMPLATE_ID}`).send({}).expect(401);
    await request(app).delete(`/api/templates/${TEMPLATE_ID}`).expect(401);
    await request(app).post(`/api/templates/${TEMPLATE_ID}/apply`).send({}).expect(401);
    await request(app).post(`/api/documents/${DOCUMENT_ID}/save-as-template`).send({}).expect(401);
  });
});

describe('template:read on the read routes', () => {
  test('returns 403 template:read for a user without template permissions', async () => {
    const viewer = makeUser({ _id: OTHER_ID, email: 'viewer@softwareone.com', permissions: ['project:read'] });
    const cookie = await loginAs(viewer);

    const listRes = await request(app).get('/api/templates').set('Cookie', cookie).expect(403);
    const detailRes = await request(app).get(`/api/templates/${TEMPLATE_ID}`).set('Cookie', cookie).expect(403);

    expect(listRes.body.error.code).toBe('FORBIDDEN');
    expect(listRes.body.error.message).toBe('Permiso requerido: template:read');
    expect(detailRes.body.error.message).toBe('Permiso requerido: template:read');
    expect(Template.aggregate).not.toHaveBeenCalled();
    expect(Template.findById).not.toHaveBeenCalled();
  });

  test('lists templates for any authenticated user with template:read regardless of project participation', async () => {
    const reader = templateReader();
    const cookie = await loginAs(reader);
    Template.aggregate.mockResolvedValue([{ _id: TEMPLATE_ID, name: 'Assessment', itemCount: 5 }]);

    const res = await request(app)
      .get('/api/templates')
      .set('Cookie', cookie)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(Template.aggregate).toHaveBeenCalled();
  });

  test('reads a template detail for a user with template:read without being a project participant', async () => {
    const reader = templateReader();
    const cookie = await loginAs(reader);
    Template.findById.mockResolvedValue(mockTemplate());

    const res = await request(app)
      .get(`/api/templates/${TEMPLATE_ID}`)
      .set('Cookie', cookie)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('Assessment');
  });
});

describe('template:write on the write routes', () => {
  test('returns 403 template:write for a reader-only user', async () => {
    const reader = templateReader();
    const cookie = await loginAs(reader);
    Template.findById.mockResolvedValue(mockTemplate());

    const postRes = await request(app)
      .post('/api/templates')
      .set('Cookie', cookie)
      .send({ name: 'New' })
      .expect(403);
    const putRes = await request(app)
      .put(`/api/templates/${TEMPLATE_ID}`)
      .set('Cookie', cookie)
      .send({ name: 'Updated' })
      .expect(403);
    const delRes = await request(app)
      .delete(`/api/templates/${TEMPLATE_ID}`)
      .set('Cookie', cookie)
      .expect(403);
    const applyRes = await request(app)
      .post(`/api/templates/${TEMPLATE_ID}/apply`)
      .set('Cookie', cookie)
      .send({ projectId: PROJECT_ID, deadline: '2026-09-30' })
      .expect(403);

    expect(postRes.body.error.message).toBe('Permiso requerido: template:write');
    expect(putRes.body.error.message).toBe('Permiso requerido: template:write');
    expect(delRes.body.error.message).toBe('Permiso requerido: template:write');
    expect(applyRes.body.error.message).toBe('Permiso requerido: template:write');
    expect(Template.findById).not.toHaveBeenCalled();
  });

  test('creates a template with template:write without requiring project participation', async () => {
    const cookie = await loginAs(templateWriter());
    templateService.saveTemplateFromSnapshot.mockResolvedValue({ _id: 't1', name: 'New', items: [] });

    const res = await request(app)
      .post('/api/templates')
      .set('Cookie', cookie)
      .send({ name: 'New', description: 'd', items: [] })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data._id).toBe('t1');
  });

  test('updates a template with template:write', async () => {
    const cookie = await loginAs(templateWriter());
    Template.findById.mockResolvedValue(mockTemplate());
    Template.findOne.mockResolvedValue(null);

    const res = await request(app)
      .put(`/api/templates/${TEMPLATE_ID}`)
      .set('Cookie', cookie)
      .send({ name: 'Assessment v2' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('Assessment v2');
  });

  test('deletes a template with template:write', async () => {
    const cookie = await loginAs(templateWriter());
    Template.findById.mockResolvedValue(mockTemplate());

    const res = await request(app)
      .delete(`/api/templates/${TEMPLATE_ID}`)
      .set('Cookie', cookie)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data._id).toBe(TEMPLATE_ID);
  });
});

describe('applying a template', () => {
  test('returns 404 when the template does not exist', async () => {
    const cookie = await loginAs(templateWriter());
    Template.findById.mockResolvedValue(null);

    const res = await request(app)
      .post(`/api/templates/${TEMPLATE_ID}/apply`)
      .set('Cookie', cookie)
      .send({ projectId: PROJECT_ID, deadline: '2026-09-30' })
      .expect(404);

    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.message).toBe('Template not found');
  });

  test('applies a template with template:write without requiring project participation', async () => {
    const cookie = await loginAs(templateWriter());
    Template.findById.mockResolvedValue(mockTemplate());
    Project.findById.mockResolvedValue(new Project({ _id: PROJECT_ID, status: 'active', participants: [] }));
    templateService.materializeTemplateItems.mockResolvedValue([]);

    const res = await request(app)
      .post(`/api/templates/${TEMPLATE_ID}/apply`)
      .set('Cookie', cookie)
      .send({ projectId: PROJECT_ID, name: 'Assessment copy', deadline: '2026-09-30' })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data._id).toBeDefined();
    expect(res.body.data.projectId).toBe(PROJECT_ID);
    expect(res.body.data.rules).toEqual([]);
  });
});

describe('save-as-template module permissions', () => {
  test('returns 403 template:write when the user lacks template:write despite having document:write', async () => {
    const user = noTemplatePermission();
    const cookie = await loginAs(user);
    Document.findById.mockResolvedValue(new Document({ _id: DOCUMENT_ID, name: 'Assessment', projectId: PROJECT_ID, status: 'pending' }));
    Project.findById.mockResolvedValue(new Project({ participants: [OTHER_ID] }));

    const res = await request(app)
      .post(`/api/documents/${DOCUMENT_ID}/save-as-template`)
      .set('Cookie', cookie)
      .send({})
      .expect(403);

    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(res.body.error.message).toBe('Permiso requerido: template:write');
  });

  test('saves a document as template with document:write + template:write', async () => {
    const cookie = await loginAs(templateWriter());
    Document.findById.mockResolvedValue(new Document({ _id: DOCUMENT_ID, name: 'Assessment', projectId: PROJECT_ID, status: 'pending' }));
    templateService.buildItemsFromRules.mockResolvedValue([]);
    templateService.saveTemplateFromSnapshot.mockResolvedValue({ _id: 't1', name: 'Assessment', items: [] });

    const res = await request(app)
      .post(`/api/documents/${DOCUMENT_ID}/save-as-template`)
      .set('Cookie', cookie)
      .send({})
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data._id).toBe('t1');
  });
});
process.env.JWT_SECRET = 'integration-secret-documents';
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
const Rule = require('../../src/models/Rule');
const { verifyPassword } = require('../../src/services/passwordService');
const { generateDocumentSection } = require('../../src/services/aiReportService');
const { generateDocumentReportMarkdown } = require('../../src/services/reportService');
const templateService = require('../../src/services/templateService');

const app = createApp();
const WRITER_ID = '507f1f77bcf86cd799439010';
const READER_ID = '507f1f77bcf86cd799439011';
const OTHER_ID = '507f1f77bcf86cd799439012';
const PROJECT_ID = '507f1f77bcf86cd799439013';
const DOCUMENT_ID = '507f1f77bcf86cd799439014';
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
  return makeUser({ permissions: ['project:write', 'document:read', 'document:write', 'template:read', 'template:write'] });
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

function mockDocumentDetail() {
  return new Document({ _id: DOCUMENT_ID, name: 'Assessment', description: 'desc', projectId: PROJECT_ID, status: 'pending' });
}

beforeEach(() => {
  jest.clearAllMocks();
  User.create = jest.fn();
  Project.findById.mockResolvedValue(new Project({ participants: [] }));
  Document.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([]) });
  Document.countDocuments.mockResolvedValue(0);
  Rule.countDocuments.mockResolvedValue(0);
  Rule.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([]) });
});

describe('authentication on the document routes', () => {
  test('returns 401 without a session on every route', async () => {
    await request(app).get(`/api/projects/${PROJECT_ID}/documents`).expect(401);
    await request(app).post(`/api/projects/${PROJECT_ID}/documents`).send({}).expect(401);
    await request(app).get(`/api/documents/${DOCUMENT_ID}`).expect(401);
    await request(app).put(`/api/documents/${DOCUMENT_ID}`).send({}).expect(401);
    await request(app).delete(`/api/documents/${DOCUMENT_ID}`).expect(401);
    await request(app).get(`/api/documents/${DOCUMENT_ID}/report`).expect(401);
    await request(app).put(`/api/documents/${DOCUMENT_ID}/report`).send({}).expect(401);
    await request(app).post(`/api/documents/${DOCUMENT_ID}/report/generate-ai`).send({}).expect(401);
    await request(app).post(`/api/documents/${DOCUMENT_ID}/save-as-template`).send({}).expect(401);
  });
});

describe('module permission on the document routes', () => {
  test('returns 403 document:read for a user without document permissions', async () => {
    const viewer = makeUser({ _id: OTHER_ID, email: 'viewer@softwareone.com', permissions: ['project:read'] });
    const cookie = await loginAs(viewer);

    const res = await request(app)
      .get(`/api/documents/${DOCUMENT_ID}`)
      .set('Cookie', cookie)
      .expect(403);

    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(res.body.error.message).toBe('Permiso requerido: document:read');
    expect(Document.findById).not.toHaveBeenCalled();
  });

  test('returns 403 document:write on write routes for a reader-only user', async () => {
    const reader = makeUser({ _id: READER_ID, email: 'reader@softwareone.com', permissions: ['document:read'] });
    const cookie = await loginAs(reader);
    Document.findById.mockResolvedValue(mockDocumentDetail());

    const postRes = await request(app)
      .post(`/api/projects/${PROJECT_ID}/documents`)
      .set('Cookie', cookie)
      .send({ name: 'Doc', deadline: '2026-09-30' })
      .expect(403);
    const putRes = await request(app)
      .put(`/api/documents/${DOCUMENT_ID}`)
      .set('Cookie', cookie)
      .send({ name: 'Updated' })
      .expect(403);
    const delRes = await request(app)
      .delete(`/api/documents/${DOCUMENT_ID}`)
      .set('Cookie', cookie)
      .expect(403);

    expect(postRes.body.error.message).toBe('Permiso requerido: document:write');
    expect(putRes.body.error.message).toBe('Permiso requerido: document:write');
    expect(delRes.body.error.message).toBe('Permiso requerido: document:write');
  });
});

describe('project participation control', () => {
  test('returns 403 for a non-participant reader on document detail', async () => {
    const reader = makeUser({ _id: READER_ID, email: 'reader@softwareone.com', permissions: ['document:read'] });
    const cookie = await loginAs(reader);
    Document.findById.mockResolvedValue(mockDocumentDetail());
    Project.findById.mockResolvedValue(new Project({ participants: [OTHER_ID] }));

    const res = await request(app)
      .get(`/api/documents/${DOCUMENT_ID}`)
      .set('Cookie', cookie)
      .expect(403);

    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(res.body.error.message).toBe('No eres participante del proyecto');
    expect(Rule.find).not.toHaveBeenCalled();
  });

  test('returns 403 for a non-participant reader on the report', async () => {
    const reader = makeUser({ _id: READER_ID, email: 'reader@softwareone.com', permissions: ['document:read'] });
    const cookie = await loginAs(reader);
    Document.findById.mockResolvedValue(mockDocumentDetail());
    Project.findById.mockResolvedValue(new Project({ participants: [OTHER_ID] }));

    const res = await request(app)
      .get(`/api/documents/${DOCUMENT_ID}/report`)
      .set('Cookie', cookie)
      .expect(403);

    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  test('allows a participant reader to read the document detail', async () => {
    const reader = makeUser({ _id: READER_ID, email: 'reader@softwareone.com', permissions: ['document:read'] });
    const cookie = await loginAs(reader);
    Document.findById.mockResolvedValue(mockDocumentDetail());
    Project.findById.mockResolvedValue(new Project({ participants: [READER_ID] }));

    const res = await request(app)
      .get(`/api/documents/${DOCUMENT_ID}`)
      .set('Cookie', cookie)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('Assessment');
  });

  test('allows a participant reader to read the report', async () => {
    const reader = makeUser({ _id: READER_ID, email: 'reader@softwareone.com', permissions: ['document:read'] });
    const cookie = await loginAs(reader);
    const document = mockDocumentDetail();
    document.reportMarkdown = '# Editado';
    document.reportEditedAt = new Date('2026-09-22T10:00:00Z');
    Document.findById.mockResolvedValue(document);
    Project.findById.mockResolvedValue(new Project({ participants: [READER_ID] }));

    const res = await request(app)
      .get(`/api/documents/${DOCUMENT_ID}/report`)
      .set('Cookie', cookie)
      .expect(200);

    expect(res.body.data.source).toBe('edited');
    expect(generateDocumentReportMarkdown).not.toHaveBeenCalled();
  });
});

describe('not found handling', () => {
  test('returns 404 NOT_FOUND for a missing document', async () => {
    const cookie = await loginAs(baseWriter());
    Document.findById.mockResolvedValue(null);

    const docRes = await request(app).get(`/api/documents/${DOCUMENT_ID}`).set('Cookie', cookie).expect(404);
    const reportRes = await request(app).get(`/api/documents/${DOCUMENT_ID}/report`).set('Cookie', cookie).expect(404);

    expect(docRes.body.error.code).toBe('NOT_FOUND');
    expect(docRes.body.error.message).toBe('Document not found');
    expect(reportRes.body.error.code).toBe('NOT_FOUND');
  });

  test('returns 404 when the owning project does not exist', async () => {
    const cookie = await loginAs(baseWriter());
    Document.findById.mockResolvedValue(mockDocumentDetail());
    Project.findById.mockResolvedValue(null);

    const res = await request(app)
      .get(`/api/documents/${DOCUMENT_ID}`)
      .set('Cookie', cookie)
      .expect(404);

    expect(res.body.error.message).toBe('Project not found');
  });

  test('returns 404 when creating a document under a missing project', async () => {
    const cookie = await loginAs(baseWriter());
    Project.findById.mockResolvedValue(null);

    const res = await request(app)
      .post(`/api/projects/${PROJECT_ID}/documents`)
      .set('Cookie', cookie)
      .send({ name: 'Doc', description: 'd', deadline: '2026-09-30', order: 1 })
      .expect(404);

    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('project:write exemption on the document write routes', () => {
  test('allows a project:write writer to create a document without being a participant', async () => {
    const cookie = await loginAs(baseWriter());
    Project.findById.mockResolvedValue(new Project({ status: 'active', participants: [] }));

    const res = await request(app)
      .post(`/api/projects/${PROJECT_ID}/documents`)
      .set('Cookie', cookie)
      .send({ name: 'Doc', description: 'd', deadline: '2026-09-30', order: 1 })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data._id).toBeDefined();
  });

  test('allows a project:write writer to update, delete, generate-ai and save-as-template', async () => {
    const cookie = await loginAs(baseWriter());
    const document = mockDocumentDetail();
    Document.findById.mockResolvedValue(document);
    generateDocumentSection.mockResolvedValue({ markdown: '# AI', generatedAt: new Date(), warnings: [] });
    templateService.buildItemsFromRules.mockResolvedValue([]);
    templateService.saveTemplateFromSnapshot.mockResolvedValue({ _id: 't1', name: 'Assessment', items: [] });

    const putRes = await request(app)
      .put(`/api/documents/${DOCUMENT_ID}`)
      .set('Cookie', cookie)
      .send({ name: 'Updated' })
      .expect(200);

    const generateRes = await request(app)
      .post(`/api/documents/${DOCUMENT_ID}/report/generate-ai`)
      .set('Cookie', cookie)
      .send({})
      .expect(200);

    const templateRes = await request(app)
      .post(`/api/documents/${DOCUMENT_ID}/save-as-template`)
      .set('Cookie', cookie)
      .send({})
      .expect(201);

    Rule.countDocuments.mockResolvedValue(0);
    Rule.deleteMany.mockResolvedValue({ deletedCount: 0 });
    const delRes = await request(app)
      .delete(`/api/documents/${DOCUMENT_ID}`)
      .set('Cookie', cookie)
      .expect(200);

    expect(putRes.body.data.name).toBe('Updated');
    expect(generateRes.body.data.markdown).toBe('# AI');
    expect(templateRes.body.data._id).toBe('t1');
    expect(delRes.body.data._id).toBe(DOCUMENT_ID);
  });

  test('blocks regeneration and deletion on completed documents', async () => {
    const cookie = await loginAs(baseWriter());
    const document = mockDocumentDetail();
    document.status = 'done';
    document.save = jest.fn().mockResolvedValue(document);
    Document.findById.mockResolvedValue(document);

    const reportRes = await request(app)
      .get(`/api/documents/${DOCUMENT_ID}/report?regenerate=true`)
      .set('Cookie', cookie)
      .expect(400);
    const delRes = await request(app)
      .delete(`/api/documents/${DOCUMENT_ID}`)
      .set('Cookie', cookie)
      .expect(400);

    expect(reportRes.body.error.code).toBe('DOCUMENT_COMPLETED');
    expect(delRes.body.error.code).toBe('DOCUMENT_COMPLETED');
  });
});
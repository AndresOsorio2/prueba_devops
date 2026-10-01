process.env.JWT_SECRET = 'integration-secret-evidences-events';
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

const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { createApp } = require('../../src/app');
const User = require('../../src/models/User');
const Project = require('../../src/models/Project');
const Document = require('../../src/models/Document');
const Rule = require('../../src/models/Rule');
const Evidence = require('../../src/models/Evidence');
const { verifyPassword } = require('../../src/services/passwordService');
const { getProjectEvents, getProjectTimeline } = require('../../src/services/eventSourcingService');

const app = createApp();
const WRITER_ID = '507f1f77bcf86cd799439030';
const READER_ID = '507f1f77bcf86cd799439031';
const OTHER_ID = '507f1f77bcf86cd799439032';
const PROJECT_ID = '507f1f77bcf86cd799439033';
const DOCUMENT_ID = '507f1f77bcf86cd799439034';
const RULE_ID = '507f1f77bcf86cd799439035';
const EVIDENCE_ID = '507f1f77bcf86cd799439036';
const EMAIL = 'user@softwareone.com';

// La evidencia existe de verdad en disco: `res.download` la sirve de verdad y
// `unlinkSync` se espia con call-through, de modo que "el archivo sigue en disco tras
// un 403" es una observacion real del filesystem y no un invariante fabricado por el mock.
// Cada test recibe su propio directorio para que un borrado no pueda arrastrar al siguiente.
let TMP_DIR;
let TMP_FILE;
let TMP_RELATIVE;

beforeEach(() => {
  TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'f92-evidence-'));
  TMP_FILE = path.join(TMP_DIR, '123-sample.pdf');
  fs.writeFileSync(TMP_FILE, 'contenido de evidencia de prueba');
  TMP_RELATIVE = path.relative(process.cwd(), TMP_FILE);
});

afterEach(() => {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

afterAll(() => {
  jest.restoreAllMocks();
});

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
  return makeUser({
    permissions: ['project:write', 'evidence:read', 'evidence:write']
  });
}

function evidenceReader() {
  return makeUser({ _id: READER_ID, email: 'reader@softwareone.com', permissions: ['evidence:read'] });
}

function evidenceEditor() {
  return makeUser({
    _id: READER_ID,
    email: 'reader@softwareone.com',
    permissions: ['evidence:read', 'evidence:write']
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

function mockRule(overrides = {}) {
  const rule = new Rule({
    _id: RULE_ID,
    documentId: DOCUMENT_ID,
    parentId: null,
    name: 'Rule 1',
    status: 'pending',
    ...overrides
  });
  rule.save = jest.fn().mockResolvedValue(rule);
  return rule;
}

function mockFileEvidence(overrides = {}) {
  return new Evidence({
    _id: EVIDENCE_ID,
    ruleId: RULE_ID,
    type: 'file',
    value: TMP_RELATIVE,
    originalName: 'sample.pdf',
    mimeType: 'application/pdf',
    size: 218,
    ...overrides
  });
}

function queryResult(data) {
  const promise = Promise.resolve(data);
  return { sort: jest.fn().mockReturnValue(promise), then: promise.then.bind(promise) };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(fs, 'unlinkSync');
  User.create = jest.fn();
  Project.findById.mockResolvedValue(new Project({ _id: PROJECT_ID, participants: [] }));
  Document.findById.mockResolvedValue(new Document({ _id: DOCUMENT_ID, projectId: PROJECT_ID, status: 'in_progress' }));
  Rule.findById.mockResolvedValue(mockRule());
  Evidence.find.mockReturnValue(queryResult([]));
  Evidence.findById.mockResolvedValue(mockFileEvidence());
  Evidence.findByIdAndDelete.mockResolvedValue({});
  Evidence.countDocuments.mockResolvedValue(1);
  getProjectEvents.mockResolvedValue([]);
  getProjectTimeline.mockResolvedValue({ milestones: [] });
});

describe('authentication on the evidence and event routes', () => {
  test('returns 401 without a session on every route', async () => {
    await request(app).get(`/api/rules/${RULE_ID}/evidences`).expect(401);
    await request(app).post(`/api/rules/${RULE_ID}/evidences`).send({}).expect(401);
    await request(app).get(`/api/evidences/${EVIDENCE_ID}/download`).expect(401);
    await request(app).delete(`/api/evidences/${EVIDENCE_ID}`).expect(401);
    await request(app).get(`/api/projects/${PROJECT_ID}/events`).expect(401);
    await request(app).get(`/api/projects/${PROJECT_ID}/timeline`).expect(401);
  });
});

describe('module permission on the evidence routes', () => {
  test('returns 403 evidence:read on read routes for a user without evidence permissions', async () => {
    const viewer = makeUser({ _id: OTHER_ID, email: 'viewer@softwareone.com', permissions: ['project:read'] });
    const cookie = await loginAs(viewer);

    const listRes = await request(app)
      .get(`/api/rules/${RULE_ID}/evidences`)
      .set('Cookie', cookie)
      .expect(403);
    const downloadRes = await request(app)
      .get(`/api/evidences/${EVIDENCE_ID}/download`)
      .set('Cookie', cookie)
      .expect(403);

    expect(listRes.body.error.code).toBe('FORBIDDEN');
    expect(listRes.body.error.message).toBe('Permiso requerido: evidence:read');
    expect(downloadRes.body.error.message).toBe('Permiso requerido: evidence:read');
    expect(Evidence.find).not.toHaveBeenCalled();
    expect(fs.unlinkSync).not.toHaveBeenCalled();
  });

  test('returns 403 evidence:write on write routes for a read-only evidence user', async () => {
    const reader = evidenceReader();
    const cookie = await loginAs(reader);

    const postRes = await request(app)
      .post(`/api/rules/${RULE_ID}/evidences`)
      .set('Cookie', cookie)
      .send({ type: 'text', value: 'Nota' })
      .expect(403);
    const deleteRes = await request(app)
      .delete(`/api/evidences/${EVIDENCE_ID}`)
      .set('Cookie', cookie)
      .expect(403);

    expect(postRes.body.error.message).toBe('Permiso requerido: evidence:write');
    expect(deleteRes.body.error.message).toBe('Permiso requerido: evidence:write');
    expect(Evidence.findByIdAndDelete).not.toHaveBeenCalled();
    expect(fs.unlinkSync).not.toHaveBeenCalled();
  });
});

describe('project participation control on the evidence routes', () => {
  test('returns 403 for a non-participant with evidence permissions', async () => {
    const outsider = makeUser({
      _id: OTHER_ID,
      email: 'outsider@softwareone.com',
      permissions: ['evidence:read', 'evidence:write']
    });
    const cookie = await loginAs(outsider);
    Project.findById.mockResolvedValue(new Project({ _id: PROJECT_ID, participants: [READER_ID] }));

    const listRes = await request(app)
      .get(`/api/rules/${RULE_ID}/evidences`)
      .set('Cookie', cookie)
      .expect(403);
    const postRes = await request(app)
      .post(`/api/rules/${RULE_ID}/evidences`)
      .set('Cookie', cookie)
      .send({ type: 'text', value: 'Nota' })
      .expect(403);
    const downloadRes = await request(app)
      .get(`/api/evidences/${EVIDENCE_ID}/download`)
      .set('Cookie', cookie)
      .expect(403);
    const deleteRes = await request(app)
      .delete(`/api/evidences/${EVIDENCE_ID}`)
      .set('Cookie', cookie)
      .expect(403);

    for (const res of [listRes, postRes, downloadRes, deleteRes]) {
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(res.body.error.message).toBe('No eres participante del proyecto');
    }
    expect(Evidence.find).not.toHaveBeenCalled();
  });

  test('does not delete the physical file when the delete is denied (AC5)', async () => {
    const outsider = makeUser({
      _id: OTHER_ID,
      email: 'outsider@softwareone.com',
      permissions: ['evidence:read', 'evidence:write']
    });
    const cookie = await loginAs(outsider);
    Project.findById.mockResolvedValue(new Project({ _id: PROJECT_ID, participants: [READER_ID] }));

    await request(app)
      .delete(`/api/evidences/${EVIDENCE_ID}`)
      .set('Cookie', cookie)
      .expect(403);

    expect(fs.unlinkSync).not.toHaveBeenCalled();
    expect(fs.existsSync(TMP_FILE)).toBe(true);
    expect(Evidence.findByIdAndDelete).not.toHaveBeenCalled();
  });
});
describe('project participation control on the event routes', () => {
  test('returns 403 for a non-participant with project:read on events and timeline', async () => {
    const reader = makeUser({ _id: READER_ID, email: 'reader@softwareone.com', permissions: ['project:read'] });
    const cookie = await loginAs(reader);
    Project.findById.mockResolvedValue(new Project({ _id: PROJECT_ID, participants: [OTHER_ID] }));

    const eventsRes = await request(app)
      .get(`/api/projects/${PROJECT_ID}/events`)
      .set('Cookie', cookie)
      .expect(403);
    const timelineRes = await request(app)
      .get(`/api/projects/${PROJECT_ID}/timeline`)
      .set('Cookie', cookie)
      .expect(403);

    expect(eventsRes.body.error.code).toBe('FORBIDDEN');
    expect(eventsRes.body.error.message).toBe('No eres participante del proyecto');
    expect(timelineRes.body.error.message).toBe('No eres participante del proyecto');
    expect(getProjectEvents).not.toHaveBeenCalled();
    expect(getProjectTimeline).not.toHaveBeenCalled();
  });

  test('returns 403 for a user with no permissions at all on events and timeline', async () => {
    const nobody = makeUser({ _id: OTHER_ID, email: 'nobody@softwareone.com', permissions: [] });
    const cookie = await loginAs(nobody);
    Project.findById.mockResolvedValue(new Project({ _id: PROJECT_ID, participants: [READER_ID] }));

    const eventsRes = await request(app)
      .get(`/api/projects/${PROJECT_ID}/events`)
      .set('Cookie', cookie)
      .expect(403);
    const timelineRes = await request(app)
      .get(`/api/projects/${PROJECT_ID}/timeline`)
      .set('Cookie', cookie)
      .expect(403);

    expect(eventsRes.body.error.code).toBe('FORBIDDEN');
    expect(timelineRes.body.error.code).toBe('FORBIDDEN');
  });

  test('allows a participant to read events and timeline of their own project', async () => {
    const reader = makeUser({ _id: READER_ID, email: 'reader@softwareone.com', permissions: [] });
    const cookie = await loginAs(reader);
    Project.findById.mockResolvedValue(new Project({ _id: PROJECT_ID, participants: [READER_ID] }));
    getProjectEvents.mockResolvedValue([{ _id: 'ev1', eventType: 'project_created' }]);

    const eventsRes = await request(app)
      .get(`/api/projects/${PROJECT_ID}/events`)
      .set('Cookie', cookie)
      .expect(200);
    const timelineRes = await request(app)
      .get(`/api/projects/${PROJECT_ID}/timeline`)
      .set('Cookie', cookie)
      .expect(200);

    expect(eventsRes.body.success).toBe(true);
    expect(eventsRes.body.data).toHaveLength(1);
    expect(timelineRes.body.success).toBe(true);
  });

  test('allows a project:write user to read events and timeline without participating', async () => {
    const cookie = await loginAs(baseWriter());
    Project.findById.mockResolvedValue(new Project({ _id: PROJECT_ID, participants: [] }));

    const eventsRes = await request(app)
      .get(`/api/projects/${PROJECT_ID}/events`)
      .set('Cookie', cookie)
      .expect(200);
    const timelineRes = await request(app)
      .get(`/api/projects/${PROJECT_ID}/timeline`)
      .set('Cookie', cookie)
      .expect(200);

    expect(eventsRes.body.success).toBe(true);
    expect(timelineRes.body.success).toBe(true);
  });
});

describe('not found handling on the evidence and event routes', () => {
  test('returns 404 for a missing evidence on delete and download', async () => {
    const cookie = await loginAs(baseWriter());
    Evidence.findById.mockResolvedValue(null);

    const deleteRes = await request(app)
      .delete(`/api/evidences/${EVIDENCE_ID}`)
      .set('Cookie', cookie)
      .expect(404);
    const downloadRes = await request(app)
      .get(`/api/evidences/${EVIDENCE_ID}/download`)
      .set('Cookie', cookie)
      .expect(404);

    expect(deleteRes.body.error.code).toBe('NOT_FOUND');
    expect(deleteRes.body.error.message).toBe('Evidence not found');
    expect(downloadRes.body.error.code).toBe('NOT_FOUND');
  });

  test('returns 404 when the owning rule of an evidence does not exist', async () => {
    const cookie = await loginAs(baseWriter());
    Rule.findById.mockResolvedValue(null);

    const res = await request(app)
      .delete(`/api/evidences/${EVIDENCE_ID}`)
      .set('Cookie', cookie)
      .expect(404);

    expect(res.body.error.message).toBe('Rule not found');
  });

  test('returns 404 when the owning document of a rule does not exist', async () => {
    const cookie = await loginAs(baseWriter());
    Document.findById.mockResolvedValue(null);

    const listRes = await request(app)
      .get(`/api/rules/${RULE_ID}/evidences`)
      .set('Cookie', cookie)
      .expect(404);
    const downloadRes = await request(app)
      .get(`/api/evidences/${EVIDENCE_ID}/download`)
      .set('Cookie', cookie)
      .expect(404);

    expect(listRes.body.error.message).toBe('Document not found');
    expect(downloadRes.body.error.message).toBe('Document not found');
  });

  test('returns 404 when the owning project of a document does not exist', async () => {
    const cookie = await loginAs(baseWriter());
    Project.findById.mockResolvedValue(null);

    const listRes = await request(app)
      .get(`/api/rules/${RULE_ID}/evidences`)
      .set('Cookie', cookie)
      .expect(404);

    expect(listRes.body.error.message).toBe('Project not found');
  });

  test('returns 404 for a missing project on events and timeline', async () => {
    const cookie = await loginAs(baseWriter());
    Project.findById.mockResolvedValue(null);

    const eventsRes = await request(app)
      .get(`/api/projects/${PROJECT_ID}/events`)
      .set('Cookie', cookie)
      .expect(404);
    const timelineRes = await request(app)
      .get(`/api/projects/${PROJECT_ID}/timeline`)
      .set('Cookie', cookie)
      .expect(404);

    expect(eventsRes.body.error.message).toBe('Project not found');
    expect(timelineRes.body.error.message).toBe('Project not found');
  });
});

describe('allowed flows on the evidence routes', () => {
  test('allows a participant with evidence:read to list and download evidences', async () => {
    const reader = evidenceReader();
    const cookie = await loginAs(reader);
    Project.findById.mockResolvedValue(new Project({ _id: PROJECT_ID, participants: [READER_ID] }));
    Evidence.find.mockReturnValue(queryResult([new Evidence({ _id: 'e1', type: 'text', value: 'Nota' })]));

    const listRes = await request(app)
      .get(`/api/rules/${RULE_ID}/evidences`)
      .set('Cookie', cookie)
      .expect(200);

    expect(listRes.body.success).toBe(true);
    expect(listRes.body.data).toHaveLength(1);

    const downloadRes = await request(app)
      .get(`/api/evidences/${EVIDENCE_ID}/download`)
      .set('Cookie', cookie)
      .expect(200);

    expect(downloadRes.status).toBe(200);
  });

  test('allows a participant with evidence:write to create and delete evidences', async () => {
    const editor = evidenceEditor();
    const cookie = await loginAs(editor);
    Project.findById.mockResolvedValue(new Project({ _id: PROJECT_ID, participants: [READER_ID] }));

    const postRes = await request(app)
      .post(`/api/rules/${RULE_ID}/evidences`)
      .set('Cookie', cookie)
      .send({ type: 'text', value: 'Nota' })
      .expect(201);

    expect(postRes.body.success).toBe(true);
    expect(postRes.body.data.type).toBe('text');

    const deleteRes = await request(app)
      .delete(`/api/evidences/${EVIDENCE_ID}`)
      .set('Cookie', cookie)
      .expect(200);

    expect(deleteRes.body.data.deleted).toBe(true);
    expect(fs.unlinkSync).toHaveBeenCalled();
    expect(fs.existsSync(TMP_FILE)).toBe(false);
  });

  test('allows a project:write user to manage evidences without participating', async () => {
    const cookie = await loginAs(baseWriter());
    Project.findById.mockResolvedValue(new Project({ _id: PROJECT_ID, participants: [] }));

    const listRes = await request(app)
      .get(`/api/rules/${RULE_ID}/evidences`)
      .set('Cookie', cookie)
      .expect(200);
    const postRes = await request(app)
      .post(`/api/rules/${RULE_ID}/evidences`)
      .set('Cookie', cookie)
      .send({ type: 'url', value: 'https://ejemplo.com' })
      .expect(201);
    const deleteRes = await request(app)
      .delete(`/api/evidences/${EVIDENCE_ID}`)
      .set('Cookie', cookie)
      .expect(200);

    expect(listRes.body.success).toBe(true);
    expect(postRes.body.success).toBe(true);
    expect(deleteRes.body.data.deleted).toBe(true);
  });
});

process.env.JWT_SECRET = 'integration-secret-document-responsible';
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

const request = require('supertest');
const { createApp } = require('../../src/app');
const User = require('../../src/models/User');
const Project = require('../../src/models/Project');
const Document = require('../../src/models/Document');
const Rule = require('../../src/models/Rule');
const Event = require('../../src/models/Event');
const { verifyPassword } = require('../../src/services/passwordService');

const app = createApp();
const PROJECT_ID = '507f1f77bcf86cd799439030';
const DOCUMENT_ID = '507f1f77bcf86cd799439031';
const CALLER_ID = '507f1f77bcf86cd799439032';
const CANDIDATE_ID = '507f1f77bcf86cd799439033';
const OUTSIDER_ID = '507f1f77bcf86cd799439034';
const PREVIOUS_ID = '507f1f77bcf86cd799439035';
const NOT_PARTICIPANT_MESSAGE = 'El usuario debe agregarse primero como participante del proyecto';

const RESPONSIBLE_URL = `/api/documents/${DOCUMENT_ID}/responsible`;

function makeUser(overrides = {}) {
  const data = {
    _id: CALLER_ID,
    email: 'caller@softwareone.com',
    passwordHash: '$2b$10$hash',
    active: true,
    permissions: [],
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

function candidateUser() {
  return {
    _id: CANDIDATE_ID,
    email: 'candidate@softwareone.com',
    passwordHash: '$2b$10$hash',
    permissions: ['document:read']
  };
}

function selects(result) {
  return { select: jest.fn().mockResolvedValue(result) };
}

function mockProject(overrides = {}) {
  return {
    _id: PROJECT_ID,
    status: 'active',
    participants: [CALLER_ID, CANDIDATE_ID],
    ...overrides
  };
}

function mockDocument(overrides = {}) {
  const document = new Document({
    _id: DOCUMENT_ID,
    projectId: PROJECT_ID,
    name: 'Assessment + POV',
    status: 'in_progress',
    deadline: '2026-10-15',
    responsible: null,
    ...overrides
  });
  document.save = jest.fn().mockResolvedValue(document);
  return document;
}

let sessionUser = null;

async function loginAs(user) {
  User.findOne.mockResolvedValue(user);
  verifyPassword.mockResolvedValue(true);
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: user.email, password: 'RealPass1' })
    .expect(200);
  return res.headers['set-cookie'][0].split(';')[0];
}

async function cookieFor(permissions) {
  sessionUser = makeUser({ permissions });
  return loginAs(sessionUser);
}

beforeEach(() => {
  jest.clearAllMocks();
  sessionUser = null;
  User.create = jest.fn();
  Document.findById.mockResolvedValue(mockDocument());
  Project.findById.mockResolvedValue(mockProject());
  Rule.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([]) });
  Rule.countDocuments.mockResolvedValue(0);
  // La sesion (authenticate.js) resuelve el usuario directamente con await, mientras que el
  // serializer encadena .select(). El mock se bifurca por argumento para servir ambos casos, y
  // devuelve el usuario que se acaba de autenticar para que conserve sus permisos.
  User.findById.mockImplementation((id) => {
    if (String(id) === CANDIDATE_ID) return selects(candidateUser());
    if (String(id) === PREVIOUS_ID) return selects({ _id: PREVIOUS_ID, email: 'prev@softwareone.com' });
    return Promise.resolve(sessionUser || makeUser({ _id: String(id) }));
  });
  User.find.mockReturnValue(selects([candidateUser()]));
});

describe('document responsible enforcement', () => {
  describe('authentication and module permission (AC4)', () => {
    test('returns 401 without a session on PUT (AC4)', async () => {
      await request(app).put(RESPONSIBLE_URL).send({ userId: CANDIDATE_ID }).expect(401);

      // La segunda asercion evita que el test pase solo porque `authenticate` responde 401 a
      // nivel de app: con sesion la ruta debe existir y exigir el permiso.
      const cookie = await cookieFor(['document:read']);
      await request(app).put(RESPONSIBLE_URL).set('Cookie', cookie).send({ userId: CANDIDATE_ID }).expect(403);
    });

    test('returns 401 without a session on DELETE (AC4)', async () => {
      await request(app).delete(RESPONSIBLE_URL).expect(401);

      const cookie = await cookieFor(['document:read']);
      await request(app).delete(RESPONSIBLE_URL).set('Cookie', cookie).expect(403);
    });

    test('returns 403 on both routes for a participant with no permissions at all', async () => {
      const cookie = await cookieFor([]);

      const put = await request(app).put(RESPONSIBLE_URL).set('Cookie', cookie).send({ userId: CANDIDATE_ID }).expect(403);
      const del = await request(app).delete(RESPONSIBLE_URL).set('Cookie', cookie).expect(403);

      expect(put.body.error.message).toBe('Permiso requerido: document:responsible');
      expect(del.body.error.message).toBe('Permiso requerido: document:responsible');
    });

    test('returns 403 when the caller has document:read and document:write but not document:responsible (AC4)', async () => {
      const cookie = await cookieFor(['document:read', 'document:write']);

      const put = await request(app).put(RESPONSIBLE_URL).set('Cookie', cookie).send({ userId: CANDIDATE_ID }).expect(403);
      const del = await request(app).delete(RESPONSIBLE_URL).set('Cookie', cookie).expect(403);

      expect(put.body.error.message).toBe('Permiso requerido: document:responsible');
      expect(del.body.error.message).toBe('Permiso requerido: document:responsible');
    });

    test('returns 403 for a non participant even holding document:responsible', async () => {
      Project.findById.mockResolvedValue(mockProject({ participants: [CANDIDATE_ID] }));
      const cookie = await cookieFor(['document:responsible']);

      const put = await request(app).put(RESPONSIBLE_URL).set('Cookie', cookie).send({ userId: CANDIDATE_ID }).expect(403);
      const del = await request(app).delete(RESPONSIBLE_URL).set('Cookie', cookie).expect(403);

      expect(put.body.error.message).toBe('No eres participante del proyecto');
      expect(del.body.error.message).toBe('No eres participante del proyecto');
    });
  });

  describe('assign and unassign (AC2, AC3)', () => {
    test('PUT assigns the responsible and returns the resolved data (AC2)', async () => {
      const document = mockDocument();
      Document.findById.mockResolvedValue(document);
      const cookie = await cookieFor(['document:read', 'document:responsible']);

      const res = await request(app)
        .put(RESPONSIBLE_URL)
        .set('Cookie', cookie)
        .send({ userId: CANDIDATE_ID })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.responsible).toEqual({ _id: CANDIDATE_ID, email: 'candidate@softwareone.com' });
      expect(document.responsible).toBe(CANDIDATE_ID);
    });

    test('PUT never exposes the passwordHash of the responsible (AC2)', async () => {
      const cookie = await cookieFor(['document:read', 'document:responsible']);

      const res = await request(app)
        .put(RESPONSIBLE_URL)
        .set('Cookie', cookie)
        .send({ userId: CANDIDATE_ID })
        .expect(200);

      expect(res.body.data.responsible).not.toHaveProperty('passwordHash');
    });

    test('PUT reassigns over a previous responsible (AC2)', async () => {
      const document = mockDocument({ responsible: PREVIOUS_ID });
      Document.findById.mockResolvedValue(document);
      const cookie = await cookieFor(['document:read', 'document:responsible']);

      await request(app).put(RESPONSIBLE_URL).set('Cookie', cookie).send({ userId: CANDIDATE_ID }).expect(200);

      expect(document.responsible).toBe(CANDIDATE_ID);
    });

    test('DELETE unassigns and returns a null responsible (AC3)', async () => {
      const document = mockDocument({ responsible: CANDIDATE_ID });
      Document.findById.mockResolvedValue(document);
      const cookie = await cookieFor(['document:read', 'document:responsible']);

      const res = await request(app).delete(RESPONSIBLE_URL).set('Cookie', cookie).expect(200);

      expect(res.body.data.responsible).toBeNull();
      expect(document.responsible).toBeNull();
    });

    test('a project:write caller outside the project can still assign (D-103)', async () => {
      Project.findById.mockResolvedValue(mockProject({ participants: [CANDIDATE_ID] }));
      const cookie = await cookieFor(['project:write', 'document:responsible']);

      const res = await request(app)
        .put(RESPONSIBLE_URL)
        .set('Cookie', cookie)
        .send({ userId: CANDIDATE_ID })
        .expect(200);

      expect(res.body.data.responsible).toEqual({ _id: CANDIDATE_ID, email: 'candidate@softwareone.com' });
    });
  });

  describe('validation (AC5, AC6, AC7, AC10)', () => {
    test('returns 400 when userId is missing (AC5)', async () => {
      const cookie = await cookieFor(['document:read', 'document:responsible']);

      const res = await request(app).put(RESPONSIBLE_URL).set('Cookie', cookie).send({}).expect(400);

      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('returns 400 when userId is not a valid ObjectId (AC5)', async () => {
      const cookie = await cookieFor(['document:read', 'document:responsible']);

      const res = await request(app).put(RESPONSIBLE_URL).set('Cookie', cookie).send({ userId: 'nope' }).expect(400);

      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('returns 404 when the candidate user does not exist (AC6)', async () => {
      User.findById.mockImplementation((id) => {
        if (String(id) === CANDIDATE_ID) return selects(null);
        if (String(id) === PREVIOUS_ID) return selects({ _id: PREVIOUS_ID, email: 'prev@softwareone.com' });
        return Promise.resolve(sessionUser || makeUser({ _id: String(id) }));
      });
      const cookie = await cookieFor(['document:read', 'document:responsible']);

      const res = await request(app)
        .put(RESPONSIBLE_URL)
        .set('Cookie', cookie)
        .send({ userId: CANDIDATE_ID })
        .expect(404);

      expect(res.body.error).toEqual(expect.objectContaining({ code: 'NOT_FOUND', message: 'User not found' }));
    });

    test('returns 400 when the candidate is not a participant, and does not add them (AC7)', async () => {
      Project.findById.mockResolvedValue(mockProject({ participants: [CALLER_ID] }));
      const document = mockDocument();
      Document.findById.mockResolvedValue(document);
      const cookie = await cookieFor(['document:read', 'document:responsible']);

      const res = await request(app)
        .put(RESPONSIBLE_URL)
        .set('Cookie', cookie)
        .send({ userId: CANDIDATE_ID })
        .expect(400);

      expect(res.body.error).toEqual(expect.objectContaining({
        code: 'VALIDATION_ERROR',
        message: NOT_PARTICIPANT_MESSAGE
      }));
      expect(document.save).not.toHaveBeenCalled();
    });

    test('returns 400 PROJECT_COMPLETED on PUT when the project is done (AC10)', async () => {
      Project.findById.mockResolvedValue(mockProject({ status: 'done' }));
      const cookie = await cookieFor(['document:read', 'document:responsible']);

      const res = await request(app)
        .put(RESPONSIBLE_URL)
        .set('Cookie', cookie)
        .send({ userId: CANDIDATE_ID })
        .expect(400);

      expect(res.body.error.code).toBe('PROJECT_COMPLETED');
    });

    test('returns 400 PROJECT_COMPLETED on DELETE when the project is unavailable (AC10)', async () => {
      Project.findById.mockResolvedValue(mockProject({ status: 'unavailable' }));
      const document = mockDocument({ responsible: CANDIDATE_ID });
      Document.findById.mockResolvedValue(document);
      const cookie = await cookieFor(['document:read', 'document:responsible']);

      const res = await request(app).delete(RESPONSIBLE_URL).set('Cookie', cookie).expect(400);

      expect(res.body.error.code).toBe('PROJECT_COMPLETED');
      expect(document.save).not.toHaveBeenCalled();
    });

    test('returns 404 when the document does not exist', async () => {
      Document.findById.mockResolvedValue(null);
      const cookie = await cookieFor(['document:read', 'document:responsible']);

      const res = await request(app)
        .put(RESPONSIBLE_URL)
        .set('Cookie', cookie)
        .send({ userId: CANDIDATE_ID })
        .expect(404);

      expect(res.body.error.message).toBe('Document not found');
    });
  });

  // El servicio de eventos NO esta mockeado: se verifica que el evento llega al modelo Event y se
  // guarda de verdad, no solo que el controller lo pidio. Esa era la asercion vacia de R1.
  describe('the event is really persisted (AC8)', () => {
    function persistedEvents() {
      return Event.mock.calls
        .map(([payload]) => payload)
        .filter((payload) => payload && payload.eventType === 'document_responsible_changed');
    }

    test('PUT persists document_responsible_changed with previous and new (AC8)', async () => {
      const document = mockDocument({ responsible: PREVIOUS_ID });
      Document.findById.mockResolvedValue(document);
      const cookie = await cookieFor(['document:read', 'document:responsible']);

      await request(app).put(RESPONSIBLE_URL).set('Cookie', cookie).send({ userId: CANDIDATE_ID }).expect(200);

      const events = persistedEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual(expect.objectContaining({
        projectId: PROJECT_ID,
        documentId: DOCUMENT_ID,
        eventType: 'document_responsible_changed',
        payload: { previousResponsible: PREVIOUS_ID, newResponsible: CANDIDATE_ID }
      }));
    });

    test('DELETE persists document_responsible_changed with a null new (AC8)', async () => {
      const document = mockDocument({ responsible: CANDIDATE_ID });
      Document.findById.mockResolvedValue(document);
      const cookie = await cookieFor(['document:read', 'document:responsible']);

      await request(app).delete(RESPONSIBLE_URL).set('Cookie', cookie).expect(200);

      const events = persistedEvents();
      expect(events).toHaveLength(1);
      expect(events[0].payload).toEqual({ previousResponsible: CANDIDATE_ID, newResponsible: null });
    });

    test('reassigning the same responsible persists no event (AC8, D-107)', async () => {
      const document = mockDocument({ responsible: CANDIDATE_ID });
      Document.findById.mockResolvedValue(document);
      const cookie = await cookieFor(['document:read', 'document:responsible']);

      await request(app).put(RESPONSIBLE_URL).set('Cookie', cookie).send({ userId: CANDIDATE_ID }).expect(200);

      expect(persistedEvents()).toHaveLength(0);
    });

    test('a rejected change persists no event (AC8)', async () => {
      const document = mockDocument({ responsible: CANDIDATE_ID });
      Document.findById.mockResolvedValue(document);
      Project.findById.mockResolvedValue(mockProject({ participants: [CALLER_ID] }));
      const cookie = await cookieFor(['document:read', 'document:responsible']);

      await request(app).put(RESPONSIBLE_URL).set('Cookie', cookie).send({ userId: CANDIDATE_ID }).expect(400);

      expect(persistedEvents()).toHaveLength(0);
    });
  });

  describe('reads expose the resolved responsible (AC9)', () => {    test('GET /api/documents/:id returns the resolved responsible (AC9)', async () => {
      Document.findById.mockResolvedValue(mockDocument({ responsible: CANDIDATE_ID }));
      const cookie = await cookieFor(['document:read']);

      const res = await request(app).get(`/api/documents/${DOCUMENT_ID}`).set('Cookie', cookie).expect(200);

      expect(res.body.data.responsible).toEqual({ _id: CANDIDATE_ID, email: 'candidate@softwareone.com' });
    });

    test('GET /api/documents/:id returns a null responsible when there is none (AC9)', async () => {
      const cookie = await cookieFor(['document:read']);

      const res = await request(app).get(`/api/documents/${DOCUMENT_ID}`).set('Cookie', cookie).expect(200);

      expect(res.body.data.responsible).toBeNull();
    });

    test('GET /api/projects/:projectId/documents returns the resolved responsible (AC9)', async () => {
      Document.find.mockReturnValue({
        sort: jest.fn().mockResolvedValue([mockDocument({ responsible: CANDIDATE_ID })])
      });
      const cookie = await cookieFor(['document:read']);

      const res = await request(app)
        .get(`/api/projects/${PROJECT_ID}/documents`)
        .set('Cookie', cookie)
        .expect(200);

      expect(res.body.data[0].responsible).toEqual({ _id: CANDIDATE_ID, email: 'candidate@softwareone.com' });
    });

    test('GET /api/projects/:projectId/documents returns nulls when nobody is responsible (AC9)', async () => {
      Document.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([mockDocument()]) });
      const cookie = await cookieFor(['document:read']);

      const res = await request(app)
        .get(`/api/projects/${PROJECT_ID}/documents`)
        .set('Cookie', cookie)
        .expect(200);

      expect(res.body.data[0].responsible).toBeNull();
    });
  });
});

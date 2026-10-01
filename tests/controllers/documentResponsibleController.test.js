jest.mock('../../src/models/Project', () => require('../mocks/mongooseModel')());
jest.mock('../../src/models/Document', () => require('../mocks/mongooseModel')());
jest.mock('../../src/models/User', () => require('../mocks/mongooseModel')());
jest.mock('../../src/services/eventSourcingService', () => ({
  createEvent: jest.fn().mockResolvedValue({})
}));
jest.mock('../../src/logger/seqLogger', () => ({
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn()
}));

const Project = require('../../src/models/Project');
const Document = require('../../src/models/Document');
const User = require('../../src/models/User');
const { createEvent } = require('../../src/services/eventSourcingService');
const {
  setDocumentResponsible,
  clearDocumentResponsible
} = require('../../src/controllers/documentResponsibleController');

const PROJECT_ID = '507f1f77bcf86cd799439030';
const DOCUMENT_ID = '507f1f77bcf86cd799439031';
const CALLER_ID = '507f1f77bcf86cd799439032';
const CANDIDATE_ID = '507f1f77bcf86cd799439033';
const OUTSIDER_ID = '507f1f77bcf86cd799439034';
const PREVIOUS_ID = '507f1f77bcf86cd799439035';
const INVALID_ID = 'not-an-object-id';

const NOT_PARTICIPANT_MESSAGE = 'El usuario debe agregarse primero como participante del proyecto';

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

function candidate(overrides = {}) {
  return {
    _id: CANDIDATE_ID,
    email: 'candidate@softwareone.com',
    passwordHash: 'secret-hash',
    permissions: ['document:read'],
    ...overrides
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
    save: jest.fn(),
    ...overrides
  };
}

function mockDocument(overrides = {}) {
  const document = new Document({
    _id: DOCUMENT_ID,
    projectId: PROJECT_ID,
    name: 'Assessment',
    status: 'in_progress',
    responsible: null,
    ...overrides
  });
  document.save = jest.fn().mockResolvedValue(document);
  return document;
}

function participantCaller(overrides = {}) {
  return { _id: CALLER_ID, permissions: ['document:read', 'document:write', 'document:responsible'], ...overrides };
}

function setReq(body = { userId: CANDIDATE_ID }) {
  return { user: participantCaller(), params: { id: DOCUMENT_ID }, body };
}

function clearReq() {
  return { user: participantCaller(), params: { id: DOCUMENT_ID }, body: {} };
}

function lastResponse(res) {
  return res.json.mock.calls[res.json.mock.calls.length - 1][0];
}

beforeEach(() => {
  jest.clearAllMocks();
  Document.findById.mockResolvedValue(mockDocument());
  Project.findById.mockResolvedValue(mockProject());
  User.findById.mockReturnValue(selects(candidate()));
});

describe('documentResponsibleController', () => {
  describe('setDocumentResponsible', () => {
    test('assigns the responsible and returns the resolved data (AC2)', async () => {
      const res = mockRes();

      await setDocumentResponsible(setReq(), res);

      expect(res.status).not.toHaveBeenCalled();
      expect(lastResponse(res)).toEqual({
        success: true,
        data: expect.objectContaining({
          _id: DOCUMENT_ID,
          responsible: { _id: CANDIDATE_ID, email: 'candidate@softwareone.com' }
        })
      });
    });

    test('persists the responsible on the document (AC2)', async () => {
      const document = mockDocument();
      Document.findById.mockResolvedValue(document);
      const res = mockRes();

      await setDocumentResponsible(setReq(), res);

      expect(document.responsible).toBe(CANDIDATE_ID);
      expect(document.save).toHaveBeenCalled();
    });

    test('reassigning over a previous responsible overwrites it (AC2)', async () => {
      const document = mockDocument({ responsible: PREVIOUS_ID });
      Document.findById.mockResolvedValue(document);
      User.findById.mockReturnValue(selects(candidate()));
      const res = mockRes();

      await setDocumentResponsible(setReq(), res);

      expect(document.responsible).toBe(CANDIDATE_ID);
    });

    test('resolves the project even though the access service already loaded it (AC7, AC10)', async () => {
      const res = mockRes();

      await setDocumentResponsible(setReq(), res);

      expect(Project.findById).toHaveBeenCalledWith(PROJECT_ID);
    });

    test('returns 400 when userId is missing (AC5)', async () => {
      const res = mockRes();

      await setDocumentResponsible(setReq({}), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(lastResponse(res).error).toEqual(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
      expect(Document.findById.mock.results.length).toBeGreaterThan(0);
      expect(createEvent).not.toHaveBeenCalled();
    });

    test('returns 400 when userId is not a valid ObjectId (AC5)', async () => {
      const res = mockRes();

      await setDocumentResponsible(setReq({ userId: INVALID_ID }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(lastResponse(res).error).toEqual(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
      expect(User.findById).not.toHaveBeenCalled();
    });

    test('returns 400 when the body itself is missing (AC5)', async () => {
      const res = mockRes();

      await setDocumentResponsible({ user: participantCaller(), params: { id: DOCUMENT_ID } }, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(lastResponse(res).error).toEqual(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
      expect(User.findById).not.toHaveBeenCalled();
    });

    test('returns 404 when the candidate user does not exist (AC6)', async () => {
      User.findById.mockReturnValue(selects(null));
      const document = mockDocument();
      Document.findById.mockResolvedValue(document);
      const res = mockRes();

      await setDocumentResponsible(setReq(), res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(lastResponse(res).error).toEqual(expect.objectContaining({ code: 'NOT_FOUND', message: 'User not found' }));
      expect(document.save).not.toHaveBeenCalled();
    });

    test('returns 404 when the document does not exist', async () => {
      Document.findById.mockResolvedValue(null);
      const res = mockRes();

      await setDocumentResponsible(setReq(), res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(lastResponse(res).error).toEqual(expect.objectContaining({ message: 'Document not found' }));
    });

    test('returns 403 when the caller is not a participant of the project', async () => {
      const res = mockRes();

      await setDocumentResponsible({
        user: { _id: OUTSIDER_ID, permissions: ['document:responsible'] },
        params: { id: DOCUMENT_ID },
        body: { userId: CANDIDATE_ID }
      }, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(createEvent).not.toHaveBeenCalled();
    });

    test('returns 400 when the candidate is not a participant, and does not add them (AC7)', async () => {
      const project = mockProject({ participants: [CALLER_ID] });
      Project.findById.mockResolvedValue(project);
      const document = mockDocument();
      Document.findById.mockResolvedValue(document);
      const res = mockRes();

      await setDocumentResponsible(setReq(), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(lastResponse(res).error).toEqual(expect.objectContaining({
        code: 'VALIDATION_ERROR',
        message: NOT_PARTICIPANT_MESSAGE
      }));
      expect(project.participants).toEqual([CALLER_ID]);
      expect(project.save).not.toHaveBeenCalled();
      expect(document.save).not.toHaveBeenCalled();
    });

    test('returns 400 PROJECT_COMPLETED when the project is done (AC10)', async () => {
      Project.findById.mockResolvedValue(mockProject({ status: 'done' }));
      const res = mockRes();

      await setDocumentResponsible(setReq(), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(lastResponse(res).error).toEqual(expect.objectContaining({ code: 'PROJECT_COMPLETED' }));
      expect(User.findById).not.toHaveBeenCalled();
    });

    test('returns 400 PROJECT_COMPLETED when the project is unavailable (AC10)', async () => {
      Project.findById.mockResolvedValue(mockProject({ status: 'unavailable' }));
      const res = mockRes();

      await setDocumentResponsible(setReq(), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(lastResponse(res).error).toEqual(expect.objectContaining({ code: 'PROJECT_COMPLETED' }));
    });

    test('still allows assignment in a paused project', async () => {
      Project.findById.mockResolvedValue(mockProject({ status: 'paused' }));
      const res = mockRes();

      await setDocumentResponsible(setReq(), res);

      expect(res.status).not.toHaveBeenCalled();
    });

    test('lets a project:write caller assign without participating (D-103)', async () => {
      Project.findById.mockResolvedValue(mockProject({ participants: [CANDIDATE_ID] }));
      const res = mockRes();

      await setDocumentResponsible({
        user: { _id: OUTSIDER_ID, permissions: ['project:write', 'document:responsible'] },
        params: { id: DOCUMENT_ID },
        body: { userId: CANDIDATE_ID }
      }, res);

      expect(res.status).not.toHaveBeenCalled();
      expect(lastResponse(res).success).toBe(true);
    });

    test('does not let a project:write caller escape the candidate participation rule (D-103, AC7)', async () => {
      Project.findById.mockResolvedValue(mockProject({ participants: [CANDIDATE_ID] }));
      const res = mockRes();

      await setDocumentResponsible({
        user: { _id: OUTSIDER_ID, permissions: ['project:write', 'document:responsible'] },
        params: { id: DOCUMENT_ID },
        body: { userId: OUTSIDER_ID }
      }, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(lastResponse(res).error).toEqual(expect.objectContaining({ message: NOT_PARTICIPANT_MESSAGE }));
    });

    test('emits document_responsible_changed with previous and new (AC8)', async () => {
      const document = mockDocument({ responsible: PREVIOUS_ID });
      Document.findById.mockResolvedValue(document);
      const res = mockRes();

      await setDocumentResponsible(setReq(), res);

      expect(createEvent).toHaveBeenCalledWith(
        'document_responsible_changed',
        { previousResponsible: PREVIOUS_ID, newResponsible: CANDIDATE_ID },
        { projectId: PROJECT_ID, documentId: DOCUMENT_ID }
      );
    });

    test('emits the event with a null previous on the first assignment (AC8)', async () => {
      const res = mockRes();

      await setDocumentResponsible(setReq(), res);

      expect(createEvent).toHaveBeenCalledWith(
        'document_responsible_changed',
        { previousResponsible: null, newResponsible: CANDIDATE_ID },
        { projectId: PROJECT_ID, documentId: DOCUMENT_ID }
      );
    });

    test('does not emit the event when the same responsible is reassigned (AC8, D-107)', async () => {
      const document = mockDocument({ responsible: CANDIDATE_ID });
      Document.findById.mockResolvedValue(document);
      const res = mockRes();

      await setDocumentResponsible(setReq(), res);

      expect(res.status).not.toHaveBeenCalled();
      expect(createEvent).not.toHaveBeenCalled();
    });

    test('returns 500 when persisting fails', async () => {
      const document = mockDocument();
      document.save = jest.fn().mockRejectedValue(new Error('db down'));
      Document.findById.mockResolvedValue(document);
      const res = mockRes();

      await setDocumentResponsible(setReq(), res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(lastResponse(res).error).toEqual(expect.objectContaining({ code: 'INTERNAL_ERROR' }));
    });
  });

  describe('clearDocumentResponsible', () => {
    test('unassigns the responsible and returns null (AC3)', async () => {
      const document = mockDocument({ responsible: CANDIDATE_ID });
      Document.findById.mockResolvedValue(document);
      const res = mockRes();

      await clearDocumentResponsible(clearReq(), res);

      expect(document.responsible).toBeNull();
      expect(document.save).toHaveBeenCalled();
      expect(lastResponse(res)).toEqual({
        success: true,
        data: expect.objectContaining({ _id: DOCUMENT_ID, responsible: null })
      });
    });

    test('emits the event with a null new responsible (AC8)', async () => {
      const document = mockDocument({ responsible: CANDIDATE_ID });
      Document.findById.mockResolvedValue(document);
      const res = mockRes();

      await clearDocumentResponsible(clearReq(), res);

      expect(createEvent).toHaveBeenCalledWith(
        'document_responsible_changed',
        { previousResponsible: CANDIDATE_ID, newResponsible: null },
        { projectId: PROJECT_ID, documentId: DOCUMENT_ID }
      );
    });

    test('does not emit the event when there was no responsible (AC8, D-107)', async () => {
      const document = mockDocument({ responsible: null });
      Document.findById.mockResolvedValue(document);
      const res = mockRes();

      await clearDocumentResponsible(clearReq(), res);

      expect(res.status).not.toHaveBeenCalled();
      expect(createEvent).not.toHaveBeenCalled();
    });

    test('returns 400 PROJECT_COMPLETED when the project is done (AC10)', async () => {
      Project.findById.mockResolvedValue(mockProject({ status: 'done' }));
      const document = mockDocument({ responsible: CANDIDATE_ID });
      Document.findById.mockResolvedValue(document);
      const res = mockRes();

      await clearDocumentResponsible(clearReq(), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(lastResponse(res).error).toEqual(expect.objectContaining({ code: 'PROJECT_COMPLETED' }));
      expect(document.save).not.toHaveBeenCalled();
    });

    test('returns 400 PROJECT_COMPLETED when the project is unavailable (AC10)', async () => {
      Project.findById.mockResolvedValue(mockProject({ status: 'unavailable' }));
      const res = mockRes();

      await clearDocumentResponsible(clearReq(), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(lastResponse(res).error).toEqual(expect.objectContaining({ code: 'PROJECT_COMPLETED' }));
    });

    test('returns 404 when the document does not exist', async () => {
      Document.findById.mockResolvedValue(null);
      const res = mockRes();

      await clearDocumentResponsible(clearReq(), res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(lastResponse(res).error).toEqual(expect.objectContaining({ message: 'Document not found' }));
    });

    test('returns 403 when the caller is not a participant of the project', async () => {
      const res = mockRes();

      await clearDocumentResponsible({
        user: { _id: OUTSIDER_ID, permissions: ['document:responsible'] },
        params: { id: DOCUMENT_ID },
        body: {}
      }, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(createEvent).not.toHaveBeenCalled();
    });

    test('returns 500 when persisting fails', async () => {
      const document = mockDocument({ responsible: CANDIDATE_ID });
      document.save = jest.fn().mockRejectedValue(new Error('db down'));
      Document.findById.mockResolvedValue(document);
      const res = mockRes();

      await clearDocumentResponsible(clearReq(), res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });
});

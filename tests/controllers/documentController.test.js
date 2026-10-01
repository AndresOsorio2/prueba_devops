jest.mock('../../src/models/Project', () => require('../mocks/mongooseModel')());
jest.mock('../../src/models/Document', () => require('../mocks/mongooseModel')());
jest.mock('../../src/models/Rule', () => require('../mocks/mongooseModel')());
jest.mock('../../src/services/eventSourcingService', () => ({
  createEvent: jest.fn().mockResolvedValue({})
}));
jest.mock('../../src/services/aiReportService', () => ({
  generateDocumentSection: jest.fn()
}));
jest.mock('../../src/services/templateService', () => {
  class TemplateNameExistsError extends Error {
    constructor(name) {
      super(`Ya existe una plantilla llamada "${name}"`);
      this.name = 'TemplateNameExistsError';
      this.code = 'TEMPLATE_NAME_EXISTS';
    }
  }
  return {
    buildItemsFromRules: jest.fn(),
    saveTemplateFromSnapshot: jest.fn(),
    TemplateNameExistsError
  };
});
jest.mock('../../src/logger/seqLogger', () => ({
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn()
}));

const Project = require('../../src/models/Project');
const Document = require('../../src/models/Document');
const Rule = require('../../src/models/Rule');
const { createEvent } = require('../../src/services/eventSourcingService');
const { generateDocumentSection } = require('../../src/services/aiReportService');
const templateService = require('../../src/services/templateService');
const logger = require('../../src/logger/seqLogger');
const {
  getDocuments,
  getDocument,
  createDocument,
  updateDocument,
  deleteDocument,
  generateAiReport
} = require('../../src/controllers/documentController');

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

const WRITER = { _id: 'me', permissions: ['project:write'] };
const READER = { _id: 'me', permissions: ['document:read'] };

beforeEach(() => {
  jest.clearAllMocks();
  Project.findById.mockResolvedValue({ _id: 'p1', participants: [] });
});

describe('documentController', () => {
  describe('getDocuments', () => {
    test('returns 404 when project does not exist', async () => {
      Project.findById.mockResolvedValue(null);
      const req = { user: WRITER, params: { projectId: 'p1' } };
      const res = mockRes();

      await getDocuments(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'NOT_FOUND', message: 'Project not found' } });
    });

    test('returns empty array when project has no documents', async () => {
      Project.findById.mockResolvedValue({ _id: 'p1' });
      const sort = jest.fn().mockResolvedValue([]);
      Document.find.mockReturnValue({ sort });
      const req = { user: WRITER, params: { projectId: 'p1' } };
      const res = mockRes();

      await getDocuments(req, res);

      expect(Document.find).toHaveBeenCalledWith({ projectId: 'p1' });
      expect(sort).toHaveBeenCalledWith({ order: 1 });
      expect(res.json).toHaveBeenCalledWith({ success: true, data: [] });
    });

    test('returns documents including ruleCount and completedRules stats', async () => {
      Project.findById.mockResolvedValue({ _id: 'p1' });
      const doc = { _id: 'd1', toObject: () => ({ _id: 'd1', name: 'Doc 1' }) };
      Document.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([doc]) });
      Rule.countDocuments.mockResolvedValueOnce(5).mockResolvedValueOnce(2);
      const req = { user: WRITER, params: { projectId: 'p1' } };
      const res = mockRes();

      await getDocuments(req, res);

      expect(Rule.countDocuments).toHaveBeenNthCalledWith(1, { documentId: 'd1' });
      expect(Rule.countDocuments).toHaveBeenNthCalledWith(2, { documentId: 'd1', status: 'done' });
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: [{ _id: 'd1', name: 'Doc 1', responsible: null, ruleCount: 5, completedRules: 2 }]
      });
    });

    test('filters documents by status', async () => {
      Project.findById.mockResolvedValue({ _id: 'p1' });
      const sort = jest.fn().mockResolvedValue([]);
      Document.find.mockReturnValue({ sort });
      const req = { user: WRITER, params: { projectId: 'p1' }, query: { status: 'pending' } };
      const res = mockRes();

      await getDocuments(req, res);

      expect(Document.find).toHaveBeenCalledWith({ projectId: 'p1', status: 'pending' });
      expect(sort).toHaveBeenCalledWith({ order: 1 });
    });

    test('filters documents by search in name and description (case-insensitive)', async () => {
      Project.findById.mockResolvedValue({ _id: 'p1' });
      const sort = jest.fn().mockResolvedValue([]);
      Document.find.mockReturnValue({ sort });
      const req = { user: WRITER, params: { projectId: 'p1' }, query: { search: 'asessSen' } };
      const res = mockRes();

      await getDocuments(req, res);

      expect(Document.find).toHaveBeenCalledWith({
        projectId: 'p1',
        $or: [
          { name: { $regex: 'asessSen', $options: 'i' } },
          { description: { $regex: 'asessSen', $options: 'i' } }
        ]
      });
      expect(sort).toHaveBeenCalledWith({ order: 1 });
    });

    test('combines search and status filters', async () => {
      Project.findById.mockResolvedValue({ _id: 'p1' });
      const sort = jest.fn().mockResolvedValue([]);
      Document.find.mockReturnValue({ sort });
      const req = { user: WRITER, params: { projectId: 'p1' }, query: { search: 'POV', status: 'done' } };
      const res = mockRes();

      await getDocuments(req, res);

      expect(Document.find).toHaveBeenCalledWith({
        projectId: 'p1',
        status: 'done',
        $or: [
          { name: { $regex: 'POV', $options: 'i' } },
          { description: { $regex: 'POV', $options: 'i' } }
        ]
      });
      expect(sort).toHaveBeenCalledWith({ order: 1 });
    });

    test('returns 500 on unexpected error', async () => {
      Project.findById.mockRejectedValue(new Error('DB down'));
      const req = { user: WRITER, params: { projectId: 'p1' } };
      const res = mockRes();

      await getDocuments(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'INTERNAL_ERROR', message: 'DB down' } });
    });

    test('without page/limit returns full array without pagination key (backward compatible)', async () => {
      Project.findById.mockResolvedValue({ _id: 'p1' });
      const doc = { _id: 'd1', toObject: () => ({ _id: 'd1', name: 'Doc 1' }) };
      Document.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([doc]) });
      Rule.countDocuments.mockResolvedValue(0);
      const req = { user: WRITER, params: { projectId: 'p1' } };
      const res = mockRes();

      await getDocuments(req, res);

      const payload = res.json.mock.calls[0][0];
      expect(payload.success).toBe(true);
      expect(Array.isArray(payload.data)).toBe(true);
      expect(payload).not.toHaveProperty('pagination');
    });

    test('returns paginated documents with data and pagination when page/limit are present', async () => {
      Project.findById.mockResolvedValue({ _id: 'p1' });
      const doc = { _id: 'd1', toObject: () => ({ _id: 'd1', name: 'Doc 1' }) };
      Document.countDocuments.mockResolvedValue(42);
      Document.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          skip: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([doc])
          })
        })
      });
      Rule.countDocuments.mockResolvedValueOnce(5).mockResolvedValueOnce(2);
      const req = { user: WRITER, params: { projectId: 'p1' }, query: { page: '1', limit: '10' } };
      const res = mockRes();

      await getDocuments(req, res);

      expect(Document.countDocuments).toHaveBeenCalledWith({ projectId: 'p1' });
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: [{ _id: 'd1', name: 'Doc 1', responsible: null, ruleCount: 5, completedRules: 2 }],
        pagination: { page: 1, limit: 10, total: 42, totalPages: 5 }
      });
    });

    test('paginates when only limit is sent, defaulting page to 1', async () => {
      Project.findById.mockResolvedValue({ _id: 'p1' });
      Document.countDocuments.mockResolvedValue(12);
      Document.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          skip: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([]) })
        })
      });
      const req = { user: WRITER, params: { projectId: 'p1' }, query: { limit: '5' } };
      const res = mockRes();

      await getDocuments(req, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        pagination: { page: 1, limit: 5, total: 12, totalPages: 3 }
      }));
    });

    test('clamps invalid page/limit values to defaults', async () => {
      Project.findById.mockResolvedValue({ _id: 'p1' });
      Document.countDocuments.mockResolvedValue(40);
      Document.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          skip: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([]) })
        })
      });
      const req = { user: WRITER, params: { projectId: 'p1' }, query: { page: '-2', limit: '999' } };
      const res = mockRes();

      await getDocuments(req, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        pagination: { page: 1, limit: 100, total: 40, totalPages: 1 }
      }));
    });

    test('returns empty data with valid pagination when page exceeds totalPages', async () => {
      Project.findById.mockResolvedValue({ _id: 'p1' });
      Document.countDocuments.mockResolvedValue(2);
      Document.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          skip: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([]) })
        })
      });
      const req = { user: WRITER, params: { projectId: 'p1' }, query: { page: '9', limit: '10' } };
      const res = mockRes();

      await getDocuments(req, res);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: [],
        pagination: { page: 9, limit: 10, total: 2, totalPages: 1 }
      });
    });

    test('pagination keeps project scoping and existing sort', async () => {
      Project.findById.mockResolvedValue({ _id: 'p1' });
      Document.countDocuments.mockResolvedValue(20);
      Document.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          skip: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([]) })
        })
      });
      const req = { user: WRITER, params: { projectId: 'p1' }, query: { page: '1', limit: '10', status: 'pending', search: 'POV' } };
      const res = mockRes();

      await getDocuments(req, res);

      expect(Document.find).toHaveBeenCalledWith({
        projectId: 'p1',
        status: 'pending',
        $or: [
          { name: { $regex: 'POV', $options: 'i' } },
          { description: { $regex: 'POV', $options: 'i' } }
        ]
      });
      expect(Document.countDocuments).toHaveBeenCalledWith({
        projectId: 'p1',
        status: 'pending',
        $or: [
          { name: { $regex: 'POV', $options: 'i' } },
          { description: { $regex: 'POV', $options: 'i' } }
        ]
      });
    });

    test('returns 403 when the user is not a participant and lacks project:write', async () => {
      Project.findById.mockResolvedValue({ _id: 'p1', participants: ['other'] });
      const req = { user: READER, params: { projectId: 'p1' } };
      const res = mockRes();

      await getDocuments(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'FORBIDDEN', message: 'No eres participante del proyecto' } });
      expect(Document.find).not.toHaveBeenCalled();
    });

    test('grants access to a participant of the project without project:write', async () => {
      Project.findById.mockResolvedValue({ _id: 'p1', participants: ['me'] });
      Document.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([]) });
      const req = { user: READER, params: { projectId: 'p1' } };
      const res = mockRes();

      await getDocuments(req, res);

      expect(res.json).toHaveBeenCalledWith({ success: true, data: [] });
    });
  });

  describe('getDocument', () => {
    test('returns 404 when document does not exist', async () => {
      Document.findById.mockResolvedValue(null);
      const req = { user: WRITER, params: { id: 'd1' } };
      const res = mockRes();

      await getDocument(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'NOT_FOUND', message: 'Document not found' } });
    });

    test('returns document with its associated rules', async () => {
      Document.findById.mockResolvedValue({ _id: 'd1', toObject: () => ({ _id: 'd1', name: 'Doc 1' }) });
      const sort = jest.fn().mockResolvedValue([{ _id: 'r1' }]);
      Rule.find.mockReturnValue({ sort });
      const req = { user: WRITER, params: { id: 'd1' } };
      const res = mockRes();

      await getDocument(req, res);

      expect(Rule.find).toHaveBeenCalledWith({ documentId: 'd1' });
      expect(sort).toHaveBeenCalledWith({ order: 1 });
      expect(res.json).toHaveBeenCalledWith({ success: true, data: { _id: 'd1', name: 'Doc 1', responsible: null, rules: [{ _id: 'r1' }] } });
    });

    test('returns 500 on unexpected error', async () => {
      Document.findById.mockRejectedValue(new Error('DB down'));
      const req = { user: WRITER, params: { id: 'd1' } };
      const res = mockRes();

      await getDocument(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'INTERNAL_ERROR', message: 'DB down' } });
    });

    test('returns 403 when the user is not a participant of the owning project', async () => {
      Document.findById.mockResolvedValue({ _id: 'd1', projectId: 'p1' });
      Project.findById.mockResolvedValue({ _id: 'p1', participants: ['other'] });
      const req = { user: READER, params: { id: 'd1' } };
      const res = mockRes();

      await getDocument(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'FORBIDDEN', message: 'No eres participante del proyecto' } });
      expect(Rule.find).not.toHaveBeenCalled();
    });

    test('returns 404 when the owning project does not exist', async () => {
      Document.findById.mockResolvedValue({ _id: 'd1', projectId: 'p1' });
      Project.findById.mockResolvedValue(null);
      const req = { user: WRITER, params: { id: 'd1' } };
      const res = mockRes();

      await getDocument(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'NOT_FOUND', message: 'Project not found' } });
    });

    test('allows a project:write user to access a project without participants', async () => {
      Document.findById.mockResolvedValue({ _id: 'd1', toObject: () => ({ _id: 'd1', name: 'Doc 1' }) });
      Rule.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([]) });
      const req = { user: WRITER, params: { id: 'd1' } };
      const res = mockRes();

      await getDocument(req, res);

      expect(res.json).toHaveBeenCalledWith({ success: true, data: { _id: 'd1', name: 'Doc 1', responsible: null, rules: [] } });
    });
  });

  describe('createDocument', () => {
    const validBody = { name: 'New Document', description: 'desc', deadline: '2026-09-30', order: 1 };

    test('returns 404 when parent project does not exist', async () => {
      Project.findById.mockResolvedValue(null);
      const req = { user: WRITER, params: { projectId: 'p1' }, body: validBody };
      const res = mockRes();

      await createDocument(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'NOT_FOUND', message: 'Project not found' } });
    });

    test('returns 403 when the user is not a participant and lacks project:write', async () => {
      Project.findById.mockResolvedValue({ _id: 'p1', status: 'active', participants: ['other'] });
      const req = { user: READER, params: { projectId: 'p1' }, body: validBody };
      const res = mockRes();

      await createDocument(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'FORBIDDEN', message: 'No eres participante del proyecto' } });
      expect(Document).not.toHaveBeenCalled();
    });

    test.each(['done', 'unavailable'])('returns 400 PROJECT_COMPLETED when project status is %s', async (status) => {
      Project.findById.mockResolvedValue({ _id: 'p1', status });
      const req = { user: WRITER, params: { projectId: 'p1' }, body: validBody };
      const res = mockRes();

      await createDocument(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: { code: 'PROJECT_COMPLETED', message: 'Cannot add documents to a completed or unavailable project' }
      });
    });

    test('creates a document with status pending when project is active', async () => {
      Project.findById.mockResolvedValue({ _id: 'p1', status: 'active' });
      const req = { user: WRITER, params: { projectId: 'p1' }, body: validBody };
      const res = mockRes();

      await createDocument(req, res);

      expect(Document).toHaveBeenCalledWith({ projectId: 'p1', name: 'New Document', description: 'desc', deadline: '2026-09-30', order: 1 });
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({ success: true, data: expect.objectContaining({ name: 'New Document' }) });
    });

    test('returns 400 VALIDATION_ERROR when required fields are missing', async () => {
      Project.findById.mockResolvedValue({ _id: 'p1', status: 'active' });
      Document.mockImplementationOnce(function () {
        this.save = jest.fn().mockRejectedValue(new Error('Document validation failed: name: Path `name` is required.'));
        return this;
      });
      const req = { user: WRITER, params: { projectId: 'p1' }, body: { description: 'desc', deadline: '2026-09-30' } };
      const res = mockRes();

      await createDocument(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, error: expect.objectContaining({ code: 'VALIDATION_ERROR' }) }));
    });

    test('also accepts saveAsTemplate flag without breaking the existing contract', async () => {
      Project.findById.mockResolvedValue({ _id: 'p1', status: 'active' });
      const req = { user: WRITER, params: { projectId: 'p1' }, body: { ...validBody, saveAsTemplate: false } };
      const res = mockRes();

      await createDocument(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(templateService.saveTemplateFromSnapshot).not.toHaveBeenCalled();
    });

    test('does not create a template when saveAsTemplate is absent', async () => {
      Project.findById.mockResolvedValue({ _id: 'p1', status: 'active' });
      const req = { user: WRITER, params: { projectId: 'p1' }, body: validBody };
      const res = mockRes();

      await createDocument(req, res);

      expect(templateService.saveTemplateFromSnapshot).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ success: true, data: expect.objectContaining({ name: 'New Document' }) });
    });

    test('saves an empty template right after creating the document when saveAsTemplate is true', async () => {
      Project.findById.mockResolvedValue({ _id: 'p1', status: 'active' });
      templateService.saveTemplateFromSnapshot.mockResolvedValue({ _id: 't1', name: 'New Document', items: [] });
      const req = { user: WRITER, params: { projectId: 'p1' }, body: { ...validBody, saveAsTemplate: true } };
      const res = mockRes();

      await createDocument(req, res);

      expect(templateService.saveTemplateFromSnapshot).toHaveBeenCalledWith({
        name: 'New Document',
        description: 'desc',
        items: []
      });
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({ success: true, data: expect.objectContaining({ name: 'New Document' }) });
      expect(res.json.mock.calls[0][0]).not.toHaveProperty('templateWarning');
    });

    test('returns templateWarning without reverting the document when the template name is duplicated', async () => {
      Project.findById.mockResolvedValue({ _id: 'p1', status: 'active' });
      templateService.saveTemplateFromSnapshot.mockRejectedValue(new templateService.TemplateNameExistsError('New Document'));
      const req = { user: WRITER, params: { projectId: 'p1' }, body: { ...validBody, saveAsTemplate: true } };
      const res = mockRes();

      await createDocument(req, res);

      expect(createEvent).toHaveBeenCalledWith(
        'document_created',
        { name: 'New Document', description: 'desc', deadline: '2026-09-30', order: 1 },
        { projectId: 'p1', documentId: expect.any(String) }
      );
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({ name: 'New Document' }),
        templateWarning: 'Ya existe una plantilla llamada "New Document"'
      });
    });

    test('logs and continues without template when template save fails for a non-duplicate reason', async () => {
      Project.findById.mockResolvedValue({ _id: 'p1', status: 'active' });
      templateService.saveTemplateFromSnapshot.mockRejectedValue(new Error('template DB down'));
      const req = { user: WRITER, params: { projectId: 'p1' }, body: { ...validBody, saveAsTemplate: true } };
      const res = mockRes();

      await createDocument(req, res);

      expect(logger.warn).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({ success: true, data: expect.objectContaining({ name: 'New Document' }) });
      expect(res.json.mock.calls[0][0]).not.toHaveProperty('templateWarning');
      expect(templateService.TemplateNameExistsError).toBeDefined();
    });
  });

  describe('updateDocument', () => {
    test('returns 404 when document does not exist', async () => {
      Document.findById.mockResolvedValue(null);
      const req = { user: WRITER, params: { id: 'd1' }, body: { name: 'Updated' } };
      const res = mockRes();

      await updateDocument(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'NOT_FOUND', message: 'Document not found' } });
    });

    test('returns 400 DOCUMENT_COMPLETED when document status is done', async () => {
      Document.findById.mockResolvedValue({ _id: 'd1', status: 'done' });
      const req = { user: WRITER, params: { id: 'd1' }, body: { name: 'Updated' } };
      const res = mockRes();

      await updateDocument(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'DOCUMENT_COMPLETED', message: 'Cannot modify completed document' } });
    });

    test('updates allowed fields when document is not done', async () => {
      const doc = { _id: 'd1', projectId: 'p1', status: 'pending', save: jest.fn().mockResolvedValue(true) };
      Document.findById.mockResolvedValue(doc);
      const req = { user: WRITER, params: { id: 'd1' }, body: { name: 'Updated', status: 'in_progress' } };
      const res = mockRes();

      await updateDocument(req, res);

      expect(doc.name).toBe('Updated');
      expect(doc.status).toBe('in_progress');
      expect(createEvent).toHaveBeenCalledWith(
        'document_status_changed',
        { previousStatus: 'pending', newStatus: 'in_progress', reason: 'manual' },
        { projectId: 'p1', documentId: 'd1' }
      );
      expect(doc.save).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ success: true, data: doc });
    });

    test('only applies whitelisted fields and scrubs unknown fields from updates', async () => {
      const doc = { _id: 'd1', projectId: 'p1', status: 'pending', name: 'Old', deadline: '2026-09-01', save: jest.fn().mockResolvedValue(true) };
      Document.findById.mockResolvedValue(doc);
      const req = {
        user: WRITER,
        params: { id: 'd1' },
        body: { name: 'Updated', deadline: '2026-10-01', malicious: 'injected', email: 'x@y.z' }
      };
      const res = mockRes();

      await updateDocument(req, res);

      expect(doc.name).toBe('Updated');
      expect(doc.deadline).toBe('2026-10-01');
      expect(doc).not.toHaveProperty('malicious');
      expect(doc).not.toHaveProperty('email');
      expect(createEvent).toHaveBeenCalledWith(
        'document_updated',
        { name: 'Updated', deadline: '2026-10-01' },
        { projectId: 'p1', documentId: 'd1' }
      );
      expect(res.json).toHaveBeenCalledWith({ success: true, data: doc });
    });

    test('returns 400 VALIDATION_ERROR when update produces an invalid status', async () => {
      const doc = {
        _id: 'd1',
        status: 'pending',
        save: jest.fn().mockRejectedValue(new Error('Document validation failed: status: `cancelado` is not a valid enum value for path `status`.'))
      };
      Document.findById.mockResolvedValue(doc);
      const req = { user: WRITER, params: { id: 'd1' }, body: { status: 'cancelado' } };
      const res = mockRes();

      await updateDocument(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, error: expect.objectContaining({ code: 'INVALID_TRANSITION' }) }));
    });

    test('returns 400 VALIDATION_ERROR on a generic validation failure', async () => {
      const doc = {
        _id: 'd1',
        status: 'pending',
        save: jest.fn().mockRejectedValue(new Error('deadline must be a valid date'))
      };
      Document.findById.mockResolvedValue(doc);
      const req = { user: WRITER, params: { id: 'd1' }, body: { deadline: 'not-a-date' } };
      const res = mockRes();

      await updateDocument(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'deadline must be a valid date' }
      });
    });
  });

  describe('deleteDocument', () => {
    test('returns 404 when document does not exist', async () => {
      Document.findById.mockResolvedValue(null);
      const req = { user: WRITER, params: { id: 'd1' } };
      const res = mockRes();

      await deleteDocument(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'NOT_FOUND', message: 'Document not found' } });
    });

    test('returns 400 DOCUMENT_COMPLETED when document is done', async () => {
      Document.findById.mockResolvedValue({ _id: 'd1', status: 'done', deleteOne: jest.fn() });
      const req = { user: WRITER, params: { id: 'd1' } };
      const res = mockRes();

      await deleteDocument(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: { code: 'DOCUMENT_COMPLETED', message: 'Cannot delete a completed document' }
      });
    });

    test('returns 400 DOCUMENT_COMPLETED when document contains completed rules', async () => {
      Document.findById.mockResolvedValue({ _id: 'd1', status: 'pending', deleteOne: jest.fn() });
      Rule.countDocuments.mockResolvedValue(2);
      const req = { user: WRITER, params: { id: 'd1' } };
      const res = mockRes();

      await deleteDocument(req, res);

      expect(Rule.countDocuments).toHaveBeenCalledWith({ documentId: 'd1', status: 'done' });
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: { code: 'DOCUMENT_COMPLETED', message: 'Cannot delete a document containing completed rules' }
      });
    });

    test('deletes the document and cascades its rules', async () => {
      const doc = { _id: 'd1', status: 'pending', deleteOne: jest.fn().mockResolvedValue(true) };
      Document.findById.mockResolvedValue(doc);
      Rule.countDocuments.mockResolvedValue(0);
      Rule.deleteMany.mockResolvedValue({ deletedCount: 3 });
      const req = { user: WRITER, params: { id: 'd1' } };
      const res = mockRes();

      await deleteDocument(req, res);

      expect(Rule.deleteMany).toHaveBeenCalledWith({ documentId: 'd1' });
      expect(doc.deleteOne).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ success: true, data: { _id: 'd1' } });
    });

    test('returns 500 on unexpected error', async () => {
      Document.findById.mockRejectedValue(new Error('DB down'));
      const req = { user: WRITER, params: { id: 'd1' } };
      const res = mockRes();

      await deleteDocument(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'INTERNAL_ERROR', message: 'DB down' } });
    });
  });

  describe('generateAiReport', () => {
    test('returns 404 when document does not exist', async () => {
      Document.findById.mockResolvedValue(null);
      const req = { user: WRITER, params: { id: 'd1' }, body: {} };
      const res = mockRes();

      await generateAiReport(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'NOT_FOUND', message: 'Document not found' } });
      expect(generateDocumentSection).not.toHaveBeenCalled();
    });

    test('returns generated markdown on success, forwarding optional instructions', async () => {
      Document.findById.mockResolvedValue({ _id: 'd1' });
      generateDocumentSection.mockResolvedValue({ markdown: '# Doc', generatedAt: new Date('2026-09-15'), warnings: [] });
      const req = { user: WRITER, params: { id: 'd1' }, body: { instructions: 'Enfócate en riesgos' } };
      const res = mockRes();

      await generateAiReport(req, res);

      expect(generateDocumentSection).toHaveBeenCalledWith('d1', { instructions: 'Enfócate en riesgos' });
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: { markdown: '# Doc', generatedAt: new Date('2026-09-15'), warnings: [] }
      });
    });

    test('works when body is missing entirely', async () => {
      Document.findById.mockResolvedValue({ _id: 'd1' });
      generateDocumentSection.mockResolvedValue({ markdown: '# Doc' });
      const req = { user: WRITER, params: { id: 'd1' } };
      const res = mockRes();

      await generateAiReport(req, res);

      expect(generateDocumentSection).toHaveBeenCalledWith('d1', { instructions: undefined });
      expect(res.json).toHaveBeenCalledWith({ success: true, data: { markdown: '# Doc' } });
    });

    test('returns 400 NO_CONTENT when the document has no rules/evidence', async () => {
      Document.findById.mockResolvedValue({ _id: 'd1' });
      generateDocumentSection.mockRejectedValue(Object.assign(new Error('Sin contenido'), { code: 'NO_CONTENT' }));
      const req = { user: WRITER, params: { id: 'd1' }, body: {} };
      const res = mockRes();

      await generateAiReport(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'NO_CONTENT', message: 'Sin contenido' } });
    });

    test('returns 500 AI_CONFIG_MISSING when Azure credentials are not configured', async () => {
      Document.findById.mockResolvedValue({ _id: 'd1' });
      generateDocumentSection.mockRejectedValue(Object.assign(new Error('Faltan credenciales'), { code: 'AI_CONFIG_MISSING' }));
      const req = { user: WRITER, params: { id: 'd1' }, body: {} };
      const res = mockRes();

      await generateAiReport(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'AI_CONFIG_MISSING', message: 'Faltan credenciales' } });
    });

    test('returns 502 AI_PROVIDER_ERROR when Azure fails', async () => {
      Document.findById.mockResolvedValue({ _id: 'd1' });
      generateDocumentSection.mockRejectedValue(Object.assign(new Error('Azure caído'), { code: 'AI_PROVIDER_ERROR' }));
      const req = { user: WRITER, params: { id: 'd1' }, body: {} };
      const res = mockRes();

      await generateAiReport(req, res);

      expect(res.status).toHaveBeenCalledWith(502);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'AI_PROVIDER_ERROR', message: 'Azure caído' } });
    });

    test('returns 500 INTERNAL_ERROR on unexpected error', async () => {
      Document.findById.mockResolvedValue({ _id: 'd1' });
      generateDocumentSection.mockRejectedValue(new Error('DB down'));
      const req = { user: WRITER, params: { id: 'd1' }, body: {} };
      const res = mockRes();

      await generateAiReport(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'INTERNAL_ERROR', message: 'DB down' } });
    });
  });
});

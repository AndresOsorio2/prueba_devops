jest.mock('../../src/models/Rule', () => require('../mocks/mongooseModel')());
jest.mock('../../src/models/Document', () => require('../mocks/mongooseModel')());
jest.mock('../../src/models/Evidence', () => require('../mocks/mongooseModel')());
jest.mock('../../src/models/Project', () => require('../mocks/mongooseModel')());
jest.mock('../../src/middleware/upload', () => ({ upload: { single: jest.fn() } }));
jest.mock('../../src/services/eventSourcingService', () => ({
  createEvent: jest.fn().mockResolvedValue({})
}));
jest.mock('fs');

const fs = require('fs');
const Rule = require('../../src/models/Rule');
const Document = require('../../src/models/Document');
const Evidence = require('../../src/models/Evidence');
const Project = require('../../src/models/Project');
const { upload } = require('../../src/middleware/upload');
const { createEvent } = require('../../src/services/eventSourcingService');
const {
  getEvidences,
  createEvidence,
  deleteEvidence,
  downloadEvidence
} = require('../../src/controllers/evidenceController');

const flushPromises = () => new Promise(resolve => setImmediate(resolve));

const WRITER = { _id: 'u1', permissions: ['project:write', 'evidence:read', 'evidence:write'] };
const PARTICIPANT = { _id: 'u2', permissions: ['evidence:read', 'evidence:write'] };
const OUTSIDER = { _id: 'u3', permissions: ['evidence:read', 'evidence:write'] };

// Inyecta el usuario autenticado en el req, como lo hace `authenticate`.
const authReq = (req, user = PARTICIPANT) => ({ user, ...req });

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn(), download: jest.fn() };
}

// Mimics a Mongoose Query: chainable via .sort() and directly awaitable.
function queryResult(data) {
  const promise = Promise.resolve(data);
  return { sort: jest.fn().mockReturnValue(promise), then: promise.then.bind(promise) };
}

beforeEach(() => {
  jest.clearAllMocks();
  Document.findById.mockResolvedValue({ _id: 'd1', projectId: 'p1' });
  Rule.findById.mockResolvedValue({ _id: 'r1', documentId: 'd1' });
  Project.findById.mockResolvedValue({ _id: 'p1', participants: [PARTICIPANT._id] });
});

describe('evidenceController', () => {
  describe('getEvidences', () => {
    test('returns 404 when rule does not exist', async () => {
      Rule.findById.mockResolvedValue(null);
      const req = authReq({ params: { ruleId: 'r1' } });
      const res = mockRes();

      await getEvidences(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'NOT_FOUND', message: 'Rule not found' } });
    });

    test('returns empty array when rule has no evidences', async () => {
      Rule.findById.mockResolvedValue({ _id: 'r1' });
      Evidence.find.mockReturnValue(queryResult([]));
      const req = authReq({ params: { ruleId: 'r1' } });
      const res = mockRes();

      await getEvidences(req, res);

      expect(Evidence.find).toHaveBeenCalledWith({ ruleId: 'r1' });
      expect(res.json).toHaveBeenCalledWith({ success: true, data: [] });
    });

    test('returns evidences of the rule sorted by createdAt', async () => {
      Rule.findById.mockResolvedValue({ _id: 'r1' });
      const evidences = [{ _id: 'e1', type: 'text', value: 'Nota' }];
      const query = queryResult(evidences);
      Evidence.find.mockReturnValue(query);
      const req = authReq({ params: { ruleId: 'r1' } });
      const res = mockRes();

      await getEvidences(req, res);

      expect(query.sort).toHaveBeenCalledWith({ createdAt: 1 });
      expect(res.json).toHaveBeenCalledWith({ success: true, data: evidences });
    });

    test('returns 500 on unexpected error', async () => {
      Rule.findById.mockRejectedValue(new Error('DB down'));
      const req = authReq({ params: { ruleId: 'r1' } });
      const res = mockRes();

      await getEvidences(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'INTERNAL_ERROR', message: 'DB down' } });
    });

    test('returns 403 when the user does not participate in the project', async () => {
      Project.findById.mockResolvedValue({ _id: 'p1', participants: ['someone-else'] });
      const req = authReq({ params: { ruleId: 'r1' } }, OUTSIDER);
      const res = mockRes();

      await getEvidences(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'FORBIDDEN', message: 'No eres participante del proyecto' } });
      expect(Evidence.find).not.toHaveBeenCalled();
    });

    test('returns 404 when the owning document of the rule does not exist', async () => {
      Evidence.findById.mockResolvedValue({ _id: 'e1', type: 'file', value: 'uploads/r1/123-sample.pdf', originalName: 'sample.pdf', ruleId: 'r1' });
      Document.findById.mockResolvedValue(null);
      const req = authReq({ params: { ruleId: 'r1' } });
      const res = mockRes();

      await getEvidences(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'NOT_FOUND', message: 'Document not found' } });
    });

    test('returns 404 when the owning project of the document does not exist', async () => {
      Project.findById.mockResolvedValue(null);
      const req = authReq({ params: { ruleId: 'r1' } });
      const res = mockRes();

      await getEvidences(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'NOT_FOUND', message: 'Project not found' } });
    });

    test('lists evidences for a project:write user without being a participant', async () => {
      Project.findById.mockResolvedValue({ _id: 'p1', participants: [] });
      Evidence.find.mockReturnValue(queryResult([]));
      const req = authReq({ params: { ruleId: 'r1' } }, WRITER);
      const res = mockRes();

      await getEvidences(req, res);

      expect(res.status).not.toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ success: true, data: [] });
    });
  });

  describe('createEvidence', () => {
    test('returns 404 when rule does not exist', async () => {
      Rule.findById.mockResolvedValue(null);
      const req = authReq({ params: { ruleId: 'r1' }, headers: {}, body: { type: 'text', value: 'x' } });
      const res = mockRes();

      await createEvidence(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'NOT_FOUND', message: 'Rule not found' } });
    });

    test('returns 400 when rule is completed', async () => {
      Rule.findById.mockResolvedValue({ _id: 'r1', status: 'done' });
      const req = authReq({ params: { ruleId: 'r1' }, headers: {}, body: { type: 'text', value: 'x' } });
      const res = mockRes();

      await createEvidence(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: { code: 'RULE_COMPLETED', message: 'Cannot add evidence to a completed rule' }
      });
    });

    test('creates a text evidence', async () => {
      Rule.findById.mockResolvedValue({ _id: 'r1', status: 'pending', documentId: 'd1' });
      Document.findById.mockResolvedValue({ _id: 'd1', projectId: 'p1' });
      const req = authReq({ params: { ruleId: 'r1' }, headers: {}, body: { type: 'text', value: 'Nota de evidencia' } });
      const res = mockRes();

      await createEvidence(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      const response = res.json.mock.calls[0][0];
      expect(response.success).toBe(true);
      expect(response.data.ruleId).toBe('r1');
      expect(response.data.type).toBe('text');
      expect(response.data.value).toBe('Nota de evidencia');
      expect(createEvent).toHaveBeenCalledWith('evidence_added', expect.objectContaining({ type: 'text' }), { projectId: 'p1', documentId: 'd1', ruleId: 'r1' });
    });

    test('creates a url evidence', async () => {
      Rule.findById.mockResolvedValue({ _id: 'r1', status: 'in_progress', documentId: 'd1', save: jest.fn().mockResolvedValue({}) });
      Document.findById.mockResolvedValue({ _id: 'd1', projectId: 'p1' });
      Evidence.countDocuments.mockResolvedValue(1);
      const req = authReq({ params: { ruleId: 'r1' }, headers: {}, body: { type: 'url', value: 'https://ejemplo.com' } });
      const res = mockRes();

      await createEvidence(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json.mock.calls[0][0].success).toBe(true);
      expect(res.json.mock.calls[0][0].data.type).toBe('url');
    });

    test('moves a pending rule to in_progress when evidence is created', async () => {
      const rule = { _id: 'r1', status: 'pending', documentId: 'd1', save: jest.fn().mockResolvedValue({}) };
      Rule.findById.mockResolvedValue(rule);
      Document.findById.mockResolvedValue({ _id: 'd1', projectId: 'p1' });
      Evidence.countDocuments.mockResolvedValue(1);
      const req = authReq({ params: { ruleId: 'r1' }, headers: {}, body: { type: 'text', value: 'Evidencia' } });
      const res = mockRes();

      await createEvidence(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(rule.status).toBe('in_progress');
      expect(rule.save).toHaveBeenCalled();
      expect(createEvent).toHaveBeenCalledWith(
        'rule_status_changed',
        { previousStatus: 'pending', newStatus: 'in_progress', reason: 'evidence_sync' },
        { projectId: 'p1', documentId: 'd1', ruleId: 'r1' }
      );
    });

    test('returns 400 on validation error (save rejects)', async () => {
      Rule.findById.mockResolvedValue({ _id: 'r1', status: 'pending' });
      Evidence.mockImplementationOnce(function (data) {
        Object.assign(this, data);
        this.save = jest.fn().mockRejectedValue(new Error('value is required'));
        return this;
      });
      const req = authReq({ params: { ruleId: 'r1' }, headers: {}, body: {} });
      const res = mockRes();

      await createEvidence(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'value is required' }
      });
    });

    test('creates a file evidence via multipart upload', async () => {
      Rule.findById.mockResolvedValue({ _id: 'r1', status: 'pending', documentId: 'd1', save: jest.fn().mockResolvedValue({}) });
      Document.findById.mockResolvedValue({ _id: 'd1', projectId: 'p1' });
      Evidence.countDocuments.mockResolvedValue(1);
      upload.single.mockReturnValue((req, res, cb) => {
        req.file = {
          path: `${process.cwd()}/uploads/r1/123-sample.pdf`,
          originalname: 'sample.pdf',
          mimetype: 'application/pdf',
          size: 218
        };
        cb(null);
      });
      const req = authReq({ params: { ruleId: 'r1' }, headers: { 'content-type': 'multipart/form-data; boundary=x' } });
      const res = mockRes();

      await createEvidence(req, res);
      await flushPromises();

      expect(res.status).toHaveBeenCalledWith(201);
      const response = res.json.mock.calls[0][0];
      expect(response.success).toBe(true);
      expect(response.data.type).toBe('file');
      expect(response.data.originalName).toBe('sample.pdf');
      expect(response.data.mimeType).toBe('application/pdf');
      expect(response.data.size).toBe(218);
      expect(createEvent).toHaveBeenCalledWith('evidence_added', expect.objectContaining({ type: 'file', fileName: 'sample.pdf' }), { projectId: 'p1', documentId: 'd1', ruleId: 'r1' });
    });

    test('returns 400 VALIDATION_ERROR when saving the file evidence fails', async () => {
      Rule.findById.mockResolvedValue({ _id: 'r1', status: 'pending' });
      upload.single.mockReturnValue((req, res, cb) => {
        req.file = {
          path: `${process.cwd()}/uploads/r1/123-sample.pdf`,
          originalname: 'sample.pdf',
          mimetype: 'application/pdf',
          size: 218
        };
        cb(null);
      });
      Evidence.mockImplementationOnce(function (data) {
        Object.assign(this, data);
        this.save = jest.fn().mockRejectedValue(new Error('disk full'));
        return this;
      });
      const req = authReq({ params: { ruleId: 'r1' }, headers: { 'content-type': 'multipart/form-data; boundary=x' } });
      const res = mockRes();

      await createEvidence(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'disk full' }
      });
    });

    test('returns 400 INVALID_FILE_TYPE when multer rejects the mimeType', async () => {
      Rule.findById.mockResolvedValue({ _id: 'r1', status: 'pending' });
      upload.single.mockReturnValue((req, res, cb) => cb(new Error('INVALID_FILE_TYPE')));
      const req = authReq({ params: { ruleId: 'r1' }, headers: { 'content-type': 'multipart/form-data; boundary=x' } });
      const res = mockRes();

      await createEvidence(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: { code: 'INVALID_FILE_TYPE', message: 'File type not allowed' }
      });
    });

    test('returns 400 FILE_TOO_LARGE when multer rejects the file size', async () => {
      Rule.findById.mockResolvedValue({ _id: 'r1', status: 'pending' });
      const multerError = Object.assign(new Error('File too large'), { code: 'LIMIT_FILE_SIZE' });
      upload.single.mockReturnValue((req, res, cb) => cb(multerError));
      const req = authReq({ params: { ruleId: 'r1' }, headers: { 'content-type': 'multipart/form-data; boundary=x' } });
      const res = mockRes();

      await createEvidence(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: { code: 'FILE_TOO_LARGE', message: 'File exceeds maximum allowed size' }
      });
    });

    test('returns 400 VALIDATION_ERROR on other multer errors', async () => {
      Rule.findById.mockResolvedValue({ _id: 'r1', status: 'pending' });
      upload.single.mockReturnValue((req, res, cb) => cb(new Error('Unexpected field')));
      const req = authReq({ params: { ruleId: 'r1' }, headers: { 'content-type': 'multipart/form-data; boundary=x' } });
      const res = mockRes();

      await createEvidence(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Unexpected field' }
      });
    });

    test('returns 400 VALIDATION_ERROR when no file is provided', async () => {
      Rule.findById.mockResolvedValue({ _id: 'r1', status: 'pending' });
      upload.single.mockReturnValue((req, res, cb) => cb(null));
      const req = authReq({ params: { ruleId: 'r1' }, headers: { 'content-type': 'multipart/form-data; boundary=x' } });
      const res = mockRes();

      await createEvidence(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'File is required' }
      });
    });

    test('returns 400 when an unexpected error occurs before creating the evidence', async () => {
      Rule.findById.mockRejectedValue(new Error('DB down'));
      const req = authReq({ params: { ruleId: 'r1' }, headers: {}, body: {} });
      const res = mockRes();

      await createEvidence(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    test('returns 403 and creates nothing when the user does not participate', async () => {
      Project.findById.mockResolvedValue({ _id: 'p1', participants: ['someone-else'] });
      const req = authReq({ params: { ruleId: 'r1' }, headers: {}, body: { type: 'text', value: 'x' } }, OUTSIDER);
      const res = mockRes();

      await createEvidence(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'FORBIDDEN', message: 'No eres participante del proyecto' } });
      expect(Evidence).not.toHaveBeenCalled();
      expect(createEvent).not.toHaveBeenCalled();
    });

    test('checks participation before the RULE_COMPLETED block', async () => {
      Project.findById.mockResolvedValue({ _id: 'p1', participants: ['someone-else'] });
      const req = authReq({ params: { ruleId: 'r1' }, headers: {}, body: { type: 'text', value: 'x' } }, OUTSIDER);
      const res = mockRes();
      Rule.findById.mockResolvedValue({ _id: 'r1', status: 'done', documentId: 'd1' });

      await createEvidence(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    test('creates an evidence for a project:write user without being a participant', async () => {
      Project.findById.mockResolvedValue({ _id: 'p1', participants: [] });
      Rule.findById.mockResolvedValue({ _id: 'r1', status: 'pending', documentId: 'd1', save: jest.fn().mockResolvedValue({}) });
      Evidence.countDocuments.mockResolvedValue(1);
      const req = authReq({ params: { ruleId: 'r1' }, headers: {}, body: { type: 'text', value: 'Nota' } }, WRITER);
      const res = mockRes();

      await createEvidence(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
    });
  });

  describe('deleteEvidence', () => {
    test('returns 404 when evidence does not exist', async () => {
      Evidence.findById.mockResolvedValue(null);
      const req = authReq({ params: { id: 'e1' } });
      const res = mockRes();

      await deleteEvidence(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'NOT_FOUND', message: 'Evidence not found' } });
    });

    test('deletes a text evidence without touching the filesystem', async () => {
      Evidence.findById.mockResolvedValue({ _id: 'e1', type: 'text', value: 'Nota', ruleId: 'r1' });
      Evidence.findByIdAndDelete.mockResolvedValue({});
      Evidence.countDocuments.mockResolvedValue(0);
      Rule.findById.mockResolvedValue({ _id: 'r1', documentId: 'd1', status: 'pending' });
      Document.findById.mockResolvedValue({ _id: 'd1', projectId: 'p1' });
      const req = authReq({ params: { id: 'e1' } });
      const res = mockRes();

      await deleteEvidence(req, res);

      expect(fs.existsSync).not.toHaveBeenCalled();
      expect(fs.unlinkSync).not.toHaveBeenCalled();
      expect(Evidence.findByIdAndDelete).toHaveBeenCalledWith('e1');
      expect(createEvent).toHaveBeenCalledWith('evidence_deleted', { ruleId: 'r1', evidenceId: 'e1', type: 'text' }, { projectId: 'p1', documentId: 'd1', ruleId: 'r1' });
      expect(res.json).toHaveBeenCalledWith({ success: true, data: { deleted: true } });
    });

    test('deletes a file evidence and removes the physical file when it exists', async () => {
      Evidence.findById.mockResolvedValue({ _id: 'e1', type: 'file', value: 'uploads/r1/123-sample.pdf', ruleId: 'r1' });
      Evidence.findByIdAndDelete.mockResolvedValue({});
      Evidence.countDocuments.mockResolvedValue(0);
      Rule.findById.mockResolvedValue({ _id: 'r1', documentId: 'd1', status: 'pending' });
      Document.findById.mockResolvedValue({ _id: 'd1', projectId: 'p1' });
      fs.existsSync.mockReturnValue(true);
      const req = authReq({ params: { id: 'e1' } });
      const res = mockRes();

      await deleteEvidence(req, res);

      expect(fs.unlinkSync).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ success: true, data: { deleted: true } });
    });

    test('deletes a file evidence when the physical file is already missing', async () => {
      Evidence.findById.mockResolvedValue({ _id: 'e1', type: 'file', value: 'uploads/r1/123-sample.pdf', ruleId: 'r1' });
      Evidence.findByIdAndDelete.mockResolvedValue({});
      Evidence.countDocuments.mockResolvedValue(0);
      Rule.findById.mockResolvedValue({ _id: 'r1', documentId: 'd1', status: 'pending' });
      Document.findById.mockResolvedValue({ _id: 'd1', projectId: 'p1' });
      fs.existsSync.mockReturnValue(false);
      const req = authReq({ params: { id: 'e1' } });
      const res = mockRes();

      await deleteEvidence(req, res);

      expect(fs.unlinkSync).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ success: true, data: { deleted: true } });
    });

    test('does not change rule status when its last evidence is deleted', async () => {
      Evidence.findById.mockResolvedValue({ _id: 'e1', type: 'text', value: 'Nota', ruleId: 'r1' });
      Evidence.findByIdAndDelete.mockResolvedValue({});
      Evidence.countDocuments.mockResolvedValue(0);
      const rule = { _id: 'r1', documentId: 'd1', status: 'done', save: jest.fn() };
      Rule.findById.mockResolvedValue(rule);
      Document.findById.mockResolvedValue({ _id: 'd1', projectId: 'p1' });
      const req = authReq({ params: { id: 'e1' } });
      const res = mockRes();

      await deleteEvidence(req, res);

      expect(rule.status).toBe('done');
      expect(rule.save).not.toHaveBeenCalled();
      expect(createEvent).not.toHaveBeenCalledWith('rule_status_changed', expect.anything(), expect.anything());
      expect(res.json).toHaveBeenCalledWith({ success: true, data: { deleted: true } });
    });

    test('keeps a done rule completed when other evidences remain after deletion', async () => {
      Evidence.findById.mockResolvedValue({ _id: 'e1', type: 'text', value: 'Nota', ruleId: 'r1' });
      Evidence.findByIdAndDelete.mockResolvedValue({});
      Evidence.countDocuments.mockResolvedValue(2);
      const rule = { _id: 'r1', documentId: 'd1', status: 'done', save: jest.fn() };
      Rule.findById.mockResolvedValue(rule);
      Document.findById.mockResolvedValue({ _id: 'd1', projectId: 'p1' });
      const req = authReq({ params: { id: 'e1' } });
      const res = mockRes();

      await deleteEvidence(req, res);

      expect(rule.status).toBe('done');
      expect(rule.save).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ success: true, data: { deleted: true } });
    });

    test('returns 500 on unexpected error', async () => {
      Evidence.findById.mockRejectedValue(new Error('DB down'));
      const req = authReq({ params: { id: 'e1' } });
      const res = mockRes();

      await deleteEvidence(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'INTERNAL_ERROR', message: 'DB down' } });
    });

    test('returns 403 for a non-participant and never touches the filesystem (AC5)', async () => {
      Project.findById.mockResolvedValue({ _id: 'p1', participants: ['someone-else'] });
      Evidence.findById.mockResolvedValue({ _id: 'e1', type: 'file', value: 'uploads/r1/123-sample.pdf', ruleId: 'r1' });
      fs.existsSync.mockReturnValue(true);
      const req = authReq({ params: { id: 'e1' } }, OUTSIDER);
      const res = mockRes();

      await deleteEvidence(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'FORBIDDEN', message: 'No eres participante del proyecto' } });
      expect(fs.existsSync).not.toHaveBeenCalled();
      expect(fs.unlinkSync).not.toHaveBeenCalled();
      expect(Evidence.findByIdAndDelete).not.toHaveBeenCalled();
    });

    test('returns 404 when the owning rule of the evidence does not exist', async () => {
      Evidence.findById.mockResolvedValue({ _id: 'e1', type: 'file', value: 'uploads/r1/123-sample.pdf', ruleId: 'r1' });
      Rule.findById.mockResolvedValue(null);
      const req = authReq({ params: { id: 'e1' } });
      const res = mockRes();

      await deleteEvidence(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'NOT_FOUND', message: 'Rule not found' } });
      expect(fs.unlinkSync).not.toHaveBeenCalled();
    });

    test('deletes the evidence for a project:write user without being a participant', async () => {
      Project.findById.mockResolvedValue({ _id: 'p1', participants: [] });
      Evidence.findById.mockResolvedValue({ _id: 'e1', type: 'text', value: 'Nota', ruleId: 'r1' });
      const req = authReq({ params: { id: 'e1' } }, WRITER);
      const res = mockRes();

      await deleteEvidence(req, res);

      expect(res.json).toHaveBeenCalledWith({ success: true, data: { deleted: true } });
    });
  });

  describe('downloadEvidence', () => {
    test('returns 404 when evidence does not exist', async () => {
      Evidence.findById.mockResolvedValue(null);
      const req = authReq({ params: { id: 'e1' } });
      const res = mockRes();

      await downloadEvidence(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'NOT_FOUND', message: 'Evidence not found' } });
      expect(fs.existsSync).not.toHaveBeenCalled();
      expect(res.download).not.toHaveBeenCalled();
    });

    test('returns 404 when evidence is not of type file', async () => {
      Evidence.findById.mockResolvedValue({ _id: 'e1', type: 'url', value: 'https://ejemplo.com' });
      const req = authReq({ params: { id: 'e1' } });
      const res = mockRes();

      await downloadEvidence(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'NOT_FOUND', message: 'Evidence file not found' } });
      expect(fs.existsSync).not.toHaveBeenCalled();
    });

    test('returns 404 when the physical file is missing on disk', async () => {
      Evidence.findById.mockResolvedValue({ _id: 'e1', type: 'file', value: 'uploads/r1/123-sample.pdf', originalName: 'sample.pdf' });
      fs.existsSync.mockReturnValue(false);
      const req = authReq({ params: { id: 'e1' } });
      const res = mockRes();

      await downloadEvidence(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'NOT_FOUND', message: 'File not found on disk' } });
    });

    test('streams the file when it exists', async () => {
      Evidence.findById.mockResolvedValue({ _id: 'e1', type: 'file', value: 'uploads/r1/123-sample.pdf', originalName: 'sample.pdf' });
      fs.existsSync.mockReturnValue(true);
      const req = authReq({ params: { id: 'e1' } });
      const res = mockRes();

      await downloadEvidence(req, res);

      expect(res.download).toHaveBeenCalledWith(expect.stringContaining('uploads/r1/123-sample.pdf'), 'sample.pdf');
    });

    test('returns 500 on unexpected error', async () => {
      Evidence.findById.mockRejectedValue(new Error('DB down'));
      const req = authReq({ params: { id: 'e1' } });
      const res = mockRes();

      await downloadEvidence(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'INTERNAL_ERROR', message: 'DB down' } });
    });

    test('returns 403 for a non-participant and never streams the file', async () => {
      Project.findById.mockResolvedValue({ _id: 'p1', participants: ['someone-else'] });
      Evidence.findById.mockResolvedValue({ _id: 'e1', type: 'file', value: 'uploads/r1/123-sample.pdf', originalName: 'sample.pdf', ruleId: 'r1' });
      fs.existsSync.mockReturnValue(true);
      const req = authReq({ params: { id: 'e1' } }, OUTSIDER);
      const res = mockRes();

      await downloadEvidence(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'FORBIDDEN', message: 'No eres participante del proyecto' } });
      expect(fs.existsSync).not.toHaveBeenCalled();
      expect(res.download).not.toHaveBeenCalled();
    });

    test('returns 404 when the owning document of the rule does not exist', async () => {
      Evidence.findById.mockResolvedValue({ _id: 'e1', type: 'file', value: 'uploads/r1/123-sample.pdf', originalName: 'sample.pdf', ruleId: 'r1' });
      Document.findById.mockResolvedValue(null);
      const req = authReq({ params: { id: 'e1' } });
      const res = mockRes();

      await downloadEvidence(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'NOT_FOUND', message: 'Document not found' } });
      expect(res.download).not.toHaveBeenCalled();
    });

    test('downloads the file for a project:write user without being a participant', async () => {
      Project.findById.mockResolvedValue({ _id: 'p1', participants: [] });
      Evidence.findById.mockResolvedValue({ _id: 'e1', type: 'file', value: 'uploads/r1/123-sample.pdf', originalName: 'sample.pdf' });
      fs.existsSync.mockReturnValue(true);
      const req = authReq({ params: { id: 'e1' } }, WRITER);
      const res = mockRes();

      await downloadEvidence(req, res);

      expect(res.download).toHaveBeenCalledWith(expect.stringContaining('uploads/r1/123-sample.pdf'), 'sample.pdf');
    });
  });
});

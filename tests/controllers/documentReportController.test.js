jest.mock('../../src/models/Document', () => require('../mocks/mongooseModel')());
jest.mock('../../src/models/Project', () => require('../mocks/mongooseModel')());
jest.mock('../../src/services/reportService', () => ({
  generateDocumentReportMarkdown: jest.fn()
}));
jest.mock('../../src/services/eventSourcingService', () => ({
  createEvent: jest.fn()
}));

const Document = require('../../src/models/Document');
const Project = require('../../src/models/Project');
const { generateDocumentReportMarkdown } = require('../../src/services/reportService');
const { createEvent } = require('../../src/services/eventSourcingService');
const { getDocumentReport, updateDocumentReport } = require('../../src/controllers/documentReportController');

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

const WRITER = { _id: 'me', permissions: ['project:write'] };
const READER = { _id: 'me', permissions: ['document:read'] };

beforeEach(() => {
  jest.clearAllMocks();
  Project.findById.mockResolvedValue({ _id: 'p1', participants: [] });
});

describe('documentReportController - getDocumentReport', () => {
  test('returns 404 when document does not exist', async () => {
    Document.findById.mockResolvedValue(null);
    const req = { user: WRITER, params: { id: 'd1' }, query: {} };
    const res = mockRes();

    await getDocumentReport(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'NOT_FOUND', message: 'Document not found' } });
  });

  test('returns edited copy when manual edition exists', async () => {
    const editedAt = new Date('2026-09-22T10:00:00Z');
    Document.findById.mockResolvedValue({ _id: 'd1', reportMarkdown: '# Editado', reportEditedAt: editedAt });
    const req = { user: WRITER, params: { id: 'd1' }, query: {} };
    const res = mockRes();

    await getDocumentReport(req, res);

    expect(generateDocumentReportMarkdown).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { markdown: '# Editado', generatedAt: editedAt, source: 'edited' }
    });
  });

  test('generates automatically when no stored copy exists', async () => {
    const generatedAt = new Date('2026-09-22T11:00:00Z');
    Document.findById.mockResolvedValue({ _id: 'd1', status: 'pending', reportMarkdown: null, save: jest.fn() });
    generateDocumentReportMarkdown.mockResolvedValue({ markdown: '# Auto', generatedAt });
    const req = { user: WRITER, params: { id: 'd1' }, query: {} };
    const res = mockRes();

    await getDocumentReport(req, res);

    expect(generateDocumentReportMarkdown).toHaveBeenCalledWith('d1');
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { markdown: '# Auto', generatedAt, source: 'auto' }
    });
  });

  test('allows read access on completed documents without persisting', async () => {
    const document = { _id: 'd1', status: 'done', reportMarkdown: null, save: jest.fn() };
    Document.findById.mockResolvedValue(document);
    generateDocumentReportMarkdown.mockResolvedValue({ markdown: '# Auto', generatedAt: new Date() });
    const req = { user: WRITER, params: { id: 'd1' }, query: {} };
    const res = mockRes();

    await getDocumentReport(req, res);

    expect(document.save).not.toHaveBeenCalled();
    expect(createEvent).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalled();
  });

  test('regenerates, overwrites stored copy and emits event', async () => {
    const generatedAt = new Date('2026-09-22T12:00:00Z');
    const document = {
      _id: 'd1',
      projectId: 'p1',
      status: 'pending',
      reportMarkdown: '# Vieja edicion',
      reportEditedAt: null,
      save: jest.fn().mockResolvedValue()
    };
    Document.findById.mockResolvedValue(document);
    generateDocumentReportMarkdown.mockResolvedValue({ markdown: '# Nueva', generatedAt });
    const req = { user: WRITER, params: { id: 'd1' }, query: { regenerate: 'true' } };
    const res = mockRes();

    await getDocumentReport(req, res);

    expect(document.reportMarkdown).toBe('# Nueva');
    expect(document.reportEditedAt).toBe(generatedAt);
    expect(document.save).toHaveBeenCalled();
    expect(createEvent).toHaveBeenCalledWith('report_generated', { regenerated: true }, { projectId: 'p1', documentId: 'd1' });
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { markdown: '# Nueva', generatedAt, source: 'regenerated' }
    });
  });

  test('blocks regeneration on completed documents', async () => {
    Document.findById.mockResolvedValue({ _id: 'd1', status: 'done', save: jest.fn() });
    const req = { user: WRITER, params: { id: 'd1' }, query: { regenerate: 'true' } };
    const res = mockRes();

    await getDocumentReport(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'DOCUMENT_COMPLETED', message: 'Cannot modify completed document' } });
    expect(generateDocumentReportMarkdown).not.toHaveBeenCalled();
    expect(createEvent).not.toHaveBeenCalled();
  });

  test('returns 500 when generation fails', async () => {
    Document.findById.mockResolvedValue({ _id: 'd1', status: 'pending', reportMarkdown: null });
    generateDocumentReportMarkdown.mockRejectedValue(new Error('DB down'));
    const req = { user: WRITER, params: { id: 'd1' }, query: {} };
    const res = mockRes();

    await getDocumentReport(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'INTERNAL_ERROR', message: 'DB down' } });
  });

  test('returns 403 when the user is not a participant of the owning project', async () => {
    Document.findById.mockResolvedValue({ _id: 'd1', projectId: 'p1' });
    Project.findById.mockResolvedValue({ _id: 'p1', participants: ['other'] });
    const req = { user: READER, params: { id: 'd1' }, query: {} };
    const res = mockRes();

    await getDocumentReport(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'FORBIDDEN', message: 'No eres participante del proyecto' } });
    expect(generateDocumentReportMarkdown).not.toHaveBeenCalled();
  });

  test('returns 404 when the owning project does not exist', async () => {
    Document.findById.mockResolvedValue({ _id: 'd1', projectId: 'p1' });
    Project.findById.mockResolvedValue(null);
    const req = { user: WRITER, params: { id: 'd1' }, query: {} };
    const res = mockRes();

    await getDocumentReport(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'NOT_FOUND', message: 'Project not found' } });
  });
});

describe('documentReportController - updateDocumentReport', () => {
  test('returns 404 when document does not exist', async () => {
    Document.findById.mockResolvedValue(null);
    const req = { user: WRITER, params: { id: 'd1' }, body: { markdown: '# x' } };
    const res = mockRes();

    await updateDocumentReport(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'NOT_FOUND', message: 'Document not found' } });
  });

  test('returns DOCUMENT_COMPLETED when document is done', async () => {
    Document.findById.mockResolvedValue({ _id: 'd1', status: 'done' });
    const req = { user: WRITER, params: { id: 'd1' }, body: { markdown: '# x' } };
    const res = mockRes();

    await updateDocumentReport(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'DOCUMENT_COMPLETED', message: 'Cannot modify completed document' } });
  });

  test.each([
    ['missing markdown', {}],
    ['non-string markdown', { markdown: 42 }],
    ['blank markdown', { markdown: '   ' }]
  ])('returns VALIDATION_ERROR for %s', async (_label, body) => {
    Document.findById.mockResolvedValue({ _id: 'd1', status: 'pending' });
    const req = { user: WRITER, params: { id: 'd1' }, body };
    const res = mockRes();

    await updateDocumentReport(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'VALIDATION_ERROR', message: 'markdown is required' } });
  });

  test('saves edition and emits report_edited event with document context', async () => {
    const document = { _id: 'd1', projectId: 'p1', name: 'Assessment + POV', status: 'pending', reportMarkdown: null, reportEditedAt: null, save: jest.fn().mockResolvedValue() };
    Document.findById.mockResolvedValue(document);
    const req = { user: WRITER, params: { id: 'd1' }, body: { markdown: '# Mi version' } };
    const res = mockRes();

    await updateDocumentReport(req, res);

    expect(document.reportMarkdown).toBe('# Mi version');
    expect(document.reportEditedAt).toBeInstanceOf(Date);
    expect(document.save).toHaveBeenCalled();
    expect(createEvent).toHaveBeenCalledWith('report_edited', { size: 12 }, { projectId: 'p1', documentId: 'd1' });
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        _id: 'd1',
        name: 'Assessment + POV',
        reportMarkdown: '# Mi version',
        reportEditedAt: document.reportEditedAt
      }
    });
  });

  test('returns 500 when save fails', async () => {
    Document.findById.mockResolvedValue({
      _id: 'd1',
      status: 'pending',
      save: jest.fn().mockRejectedValue(new Error('DB down'))
    });
    const req = { user: WRITER, params: { id: 'd1' }, body: { markdown: '# x' } };
    const res = mockRes();

    await updateDocumentReport(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'INTERNAL_ERROR', message: 'DB down' } });
  });

  test('returns 403 when the user is not a participant of the owning project', async () => {
    Document.findById.mockResolvedValue({ _id: 'd1', projectId: 'p1' });
    Project.findById.mockResolvedValue({ _id: 'p1', participants: ['other'] });
    const req = { user: READER, params: { id: 'd1' }, body: { markdown: '# x' } };
    const res = mockRes();

    await updateDocumentReport(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'FORBIDDEN', message: 'No eres participante del proyecto' } });
  });
});

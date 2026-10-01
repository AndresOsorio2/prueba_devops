jest.mock('../../src/models/Evidence', () => require('../mocks/mongooseModel')());
jest.mock('../../src/models/Rule', () => require('../mocks/mongooseModel')());
jest.mock('../../src/models/Document', () => require('../mocks/mongooseModel')());
jest.mock('../../src/models/Project', () => require('../mocks/mongooseModel')());

const Evidence = require('../../src/models/Evidence');
const Rule = require('../../src/models/Rule');
const Document = require('../../src/models/Document');
const Project = require('../../src/models/Project');
const { resolveEvidenceWithAccess } = require('../../src/services/evidenceAccessService');

const WRITER = { _id: 'u1', permissions: ['project:write'] };
const PARTICIPANT = { _id: 'u2', permissions: ['evidence:read', 'evidence:write'] };
const OUTSIDER = { _id: 'u3', permissions: ['evidence:read', 'evidence:write'] };
const DOCUMENT = { _id: 'd1', projectId: 'p1' };
const RULE = { _id: 'r1', documentId: 'd1' };
const EVIDENCE = { _id: 'e1', ruleId: 'r1', type: 'file', value: 'uploads/r1/a.pdf' };
const PROJECT = { _id: 'p1', participants: ['u1', 'u2'] };

beforeEach(() => {
  jest.clearAllMocks();
  Evidence.findById.mockResolvedValue(EVIDENCE);
  Rule.findById.mockResolvedValue(RULE);
  Document.findById.mockResolvedValue(DOCUMENT);
  Project.findById.mockResolvedValue(PROJECT);
});

describe('evidenceAccessService', () => {
  describe('resolveEvidenceWithAccess', () => {
    test('returns 404 NOT_FOUND when the evidence does not exist', async () => {
      Evidence.findById.mockResolvedValue(null);

      const result = await resolveEvidenceWithAccess(PARTICIPANT, 'e1');

      expect(result).toEqual({ ok: false, status: 404, error: { code: 'NOT_FOUND', message: 'Evidence not found' } });
      expect(Rule.findById).not.toHaveBeenCalled();
    });

    test('resolves the evidence through the chain rule, document and project', async () => {
      const result = await resolveEvidenceWithAccess(PARTICIPANT, 'e1');

      expect(Evidence.findById).toHaveBeenCalledWith('e1');
      expect(Rule.findById).toHaveBeenCalledWith('r1');
      expect(Document.findById).toHaveBeenCalledWith('d1');
      expect(Project.findById).toHaveBeenCalledWith('p1');
      expect(result).toEqual({ ok: true, evidence: EVIDENCE, rule: RULE, document: DOCUMENT, project: PROJECT });
    });

    test('propagates the 404 when the owning rule does not exist', async () => {
      Rule.findById.mockResolvedValue(null);

      const result = await resolveEvidenceWithAccess(PARTICIPANT, 'e1');

      expect(result).toEqual({ ok: false, status: 404, error: { code: 'NOT_FOUND', message: 'Rule not found' } });
      expect(Document.findById).not.toHaveBeenCalled();
    });

    test('propagates the 404 when the owning document does not exist', async () => {
      Document.findById.mockResolvedValue(null);

      const result = await resolveEvidenceWithAccess(PARTICIPANT, 'e1');

      expect(result).toEqual({ ok: false, status: 404, error: { code: 'NOT_FOUND', message: 'Document not found' } });
      expect(Project.findById).not.toHaveBeenCalled();
    });

    test('propagates the 404 when the owning project does not exist', async () => {
      Project.findById.mockResolvedValue(null);

      const result = await resolveEvidenceWithAccess(PARTICIPANT, 'e1');

      expect(result).toEqual({ ok: false, status: 404, error: { code: 'NOT_FOUND', message: 'Project not found' } });
    });

    test('returns 403 FORBIDDEN when the user is a non-participant without project:write', async () => {
      Project.findById.mockResolvedValue({ _id: 'p1', participants: ['other'] });

      const result = await resolveEvidenceWithAccess(OUTSIDER, 'e1');

      expect(result).toEqual({ ok: false, status: 403, error: { code: 'FORBIDDEN', message: 'No eres participante del proyecto' } });
    });

    test('resolves the evidence for a project:write user even without participants', async () => {
      Project.findById.mockResolvedValue({ _id: 'p1', participants: [] });

      const result = await resolveEvidenceWithAccess(WRITER, 'e1');

      expect(result.ok).toBe(true);
      expect(result.evidence).toBe(EVIDENCE);
    });

    test('returns 403 FORBIDDEN when there is no authenticated user', async () => {
      const result = await resolveEvidenceWithAccess(undefined, 'e1');

      expect(result).toEqual({ ok: false, status: 403, error: { code: 'FORBIDDEN', message: 'No eres participante del proyecto' } });
    });
  });
});

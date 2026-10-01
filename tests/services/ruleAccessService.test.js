jest.mock('../../src/models/Rule', () => require('../mocks/mongooseModel')());
jest.mock('../../src/models/Document', () => require('../mocks/mongooseModel')());
jest.mock('../../src/models/Project', () => require('../mocks/mongooseModel')());

const Rule = require('../../src/models/Rule');
const Document = require('../../src/models/Document');
const Project = require('../../src/models/Project');
const { resolveRuleWithAccess } = require('../../src/services/ruleAccessService');

const WRITER = { _id: 'u1', permissions: ['project:write'] };
const PARTICIPANT = { _id: 'u2', permissions: ['rule:read', 'rule:write'] };
const OUTSIDER = { _id: 'u3', permissions: ['rule:read', 'rule:write'] };
const PROJECT = { _id: 'p1', participants: ['u1', 'u2'] };
const DOCUMENT = { _id: 'd1', projectId: 'p1' };
const RULE = { _id: 'r1', documentId: 'd1' };

describe('ruleAccessService', () => {
  describe('resolveRuleWithAccess', () => {
    test('returns 404 NOT_FOUND when the rule does not exist', async () => {
      Rule.findById.mockResolvedValue(null);

      const result = await resolveRuleWithAccess(PARTICIPANT, 'r1');

      expect(result).toEqual({ ok: false, status: 404, error: { code: 'NOT_FOUND', message: 'Rule not found' } });
      expect(Document.findById).not.toHaveBeenCalled();
    });

    test('returns 404 NOT_FOUND when the owning document does not exist', async () => {
      Rule.findById.mockResolvedValue(RULE);
      Document.findById.mockResolvedValue(null);

      const result = await resolveRuleWithAccess(PARTICIPANT, 'r1');

      expect(result).toEqual({ ok: false, status: 404, error: { code: 'NOT_FOUND', message: 'Document not found' } });
      expect(Project.findById).not.toHaveBeenCalled();
    });

    test('returns 404 NOT_FOUND when the owning project does not exist', async () => {
      Rule.findById.mockResolvedValue(RULE);
      Document.findById.mockResolvedValue(DOCUMENT);
      Project.findById.mockResolvedValue(null);

      const result = await resolveRuleWithAccess(PARTICIPANT, 'r1');

      expect(Project.findById).toHaveBeenCalledWith('p1');
      expect(result).toEqual({ ok: false, status: 404, error: { code: 'NOT_FOUND', message: 'Project not found' } });
    });

    test('returns 403 FORBIDDEN when the user is a non-participant without project:write', async () => {
      Rule.findById.mockResolvedValue(RULE);
      Document.findById.mockResolvedValue(DOCUMENT);
      Project.findById.mockResolvedValue({ _id: 'p1', participants: ['other'] });

      const result = await resolveRuleWithAccess(OUTSIDER, 'r1');

      expect(result).toEqual({ ok: false, status: 403, error: { code: 'FORBIDDEN', message: 'No eres participante del proyecto' } });
    });

    test('resolves the rule for a project:write user even without participants', async () => {
      Rule.findById.mockResolvedValue(RULE);
      Document.findById.mockResolvedValue(DOCUMENT);
      Project.findById.mockResolvedValue({ _id: 'p1', participants: [] });

      const result = await resolveRuleWithAccess(WRITER, 'r1');

      expect(result).toEqual({ ok: true, rule: RULE, document: DOCUMENT, project: { _id: 'p1', participants: [] } });
    });

    test('resolves the rule for a participant without project:write', async () => {
      Rule.findById.mockResolvedValue(RULE);
      Document.findById.mockResolvedValue(DOCUMENT);
      Project.findById.mockResolvedValue(PROJECT);

      const result = await resolveRuleWithAccess(PARTICIPANT, 'r1');

      expect(result).toEqual({ ok: true, rule: RULE, document: DOCUMENT, project: PROJECT });
    });

    test('applies the same access check for a nested sub-rule at any depth', async () => {
      const subRule = { _id: 'r3', parentId: 'r2', documentId: 'd1' };
      Rule.findById.mockResolvedValue(subRule);
      Document.findById.mockResolvedValue(DOCUMENT);
      Project.findById.mockResolvedValue(PROJECT);

      const result = await resolveRuleWithAccess(OUTSIDER, 'r3');

      expect(result).toEqual({ ok: false, status: 403, error: { code: 'FORBIDDEN', message: 'No eres participante del proyecto' } });

      const resultParticipant = await resolveRuleWithAccess(PARTICIPANT, 'r3');
      expect(resultParticipant).toEqual({ ok: true, rule: subRule, document: DOCUMENT, project: PROJECT });
    });
  });
});
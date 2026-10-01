jest.mock('../../src/models/Document', () => require('../mocks/mongooseModel')());
jest.mock('../../src/models/Rule', () => require('../mocks/mongooseModel')());
jest.mock('../../src/models/Evidence', () => require('../mocks/mongooseModel')());
jest.mock('../../src/models/Project', () => require('../mocks/mongooseModel')());
jest.mock('../../src/services/eventSourcingService', () => ({
  createEvent: jest.fn().mockResolvedValue({})
}));

const Document = require('../../src/models/Document');
const Rule = require('../../src/models/Rule');
const Evidence = require('../../src/models/Evidence');
const Project = require('../../src/models/Project');
const { createEvent } = require('../../src/services/eventSourcingService');
const {
  getRules,
  getRule,
  createRule,
  updateRule,
  changeRuleStatus,
  deleteRule
} = require('../../src/controllers/ruleController');

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

// Mimics a Mongoose Query: chainable via .sort() and directly awaitable.
function queryResult(data) {
  const promise = Promise.resolve(data);
  return { sort: jest.fn().mockReturnValue(promise), then: promise.then.bind(promise) };
}

function withToObject(rule) {
  return { ...rule, toObject: () => ({ ...rule }) };
}

const WRITER = { _id: 'u1', permissions: ['project:write'] };
const PARTICIPANT = { _id: 'u2', permissions: ['rule:read', 'rule:write'] };
const OUTSIDER = { _id: 'u3', permissions: ['rule:read', 'rule:write'] };

// Fakes Rule.find over an in-memory fixture, so recursive tree-building code
// (arbitrary depth) resolves deterministically. Supports filtering by
// { documentId, parentId } (buildRuleTree) and by { documentId } only (getAllRules).
function mockRuleHierarchy(rules) {
  Rule.find.mockImplementation((query) => {
    let matches = rules;
    if (query.documentId) {
      matches = matches.filter((r) => String(r.documentId) === String(query.documentId));
    }
    if (query.parentId !== undefined) {
      matches = matches.filter((r) => String(r.parentId || null) === String(query.parentId));
    }
    return queryResult(matches.map(withToObject));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  Document.findById.mockResolvedValue({ _id: 'd1', projectId: 'p1' });
  Project.findById.mockResolvedValue({ _id: 'p1', participants: ['u2'] });
});

describe('ruleController', () => {
  describe('getRules', () => {
    test('returns 404 when document does not exist', async () => {
      Document.findById.mockResolvedValue(null);
      const req = { user: WRITER, params: { documentId: 'd1' } };
      const res = mockRes();

      await getRules(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'NOT_FOUND', message: 'Document not found' } });
    });

    test('returns empty array when document has no rules', async () => {
      Document.findById.mockResolvedValue({ _id: 'd1' });
      mockRuleHierarchy([]);
      const req = { user: WRITER, params: { documentId: 'd1' } };
      const res = mockRes();

      await getRules(req, res);

      expect(res.json).toHaveBeenCalledWith({ success: true, data: [] });
    });

    test('returns a recursive tree with nested children (multiple levels)', async () => {
      Document.findById.mockResolvedValue({ _id: 'd1' });
      mockRuleHierarchy([
        { _id: 'r1', documentId: 'd1', parentId: null, name: 'Root' },
        { _id: 'r2', documentId: 'd1', parentId: 'r1', name: 'Child' },
        { _id: 'r3', documentId: 'd1', parentId: 'r2', name: 'Grandchild' }
      ]);
      const req = { user: WRITER, params: { documentId: 'd1' } };
      const res = mockRes();

      await getRules(req, res);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: [
          {
            _id: 'r1',
            documentId: 'd1',
            parentId: null,
            name: 'Root',
            children: [
              {
                _id: 'r2',
                documentId: 'd1',
                parentId: 'r1',
                name: 'Child',
                children: [
                  { _id: 'r3', documentId: 'd1', parentId: 'r2', name: 'Grandchild', children: [] }
                ]
              }
            ]
          }
        ]
      });
    });

    test('filters rules by status preserving the tree structure', async () => {
      Document.findById.mockResolvedValue({ _id: 'd1' });
      mockRuleHierarchy([
        { _id: 'r1', documentId: 'd1', parentId: null, name: 'Root', status: 'pending' },
        { _id: 'r2', documentId: 'd1', parentId: 'r1', name: 'Child', status: 'done' },
        { _id: 'r3', documentId: 'd1', parentId: 'r1', name: 'Sibling', status: 'pending' }
      ]);
      const req = { user: WRITER, params: { documentId: 'd1' }, query: { status: 'done' } };
      const res = mockRes();

      await getRules(req, res);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: [
          {
            _id: 'r1',
            documentId: 'd1',
            parentId: null,
            name: 'Root',
            status: 'pending',
            children: [
              { _id: 'r2', documentId: 'd1', parentId: 'r1', name: 'Child', status: 'done', children: [] }
            ]
          }
        ]
      });
    });

    test('filters rules by search preserving ancestors to root', async () => {
      Document.findById.mockResolvedValue({ _id: 'd1' });
      mockRuleHierarchy([
        { _id: 'r1', documentId: 'd1', parentId: null, name: 'Root', description: 'top' },
        { _id: 'r2', documentId: 'd1', parentId: 'r1', name: 'Arquitectura de Solución', description: 'detalle' },
        { _id: 'r3', documentId: 'd1', parentId: 'r2', name: 'Otro nodo', description: 'irrelevante' }
      ]);
      const req = { user: WRITER, params: { documentId: 'd1' }, query: { search: 'arquitectura' } };
      const res = mockRes();

      await getRules(req, res);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: [
          {
            _id: 'r1',
            documentId: 'd1',
            parentId: null,
            name: 'Root',
            description: 'top',
            children: [
              {
                _id: 'r2',
                documentId: 'd1',
                parentId: 'r1',
                name: 'Arquitectura de Solución',
                description: 'detalle',
                children: []
              }
            ]
          }
        ]
      });
    });

    test('combines search and status filters', async () => {
      Document.findById.mockResolvedValue({ _id: 'd1' });
      mockRuleHierarchy([
        { _id: 'r1', documentId: 'd1', parentId: null, name: 'Root', status: 'pending' },
        { _id: 'r2', documentId: 'd1', parentId: 'r1', name: 'Diagrama', status: 'done' },
        { _id: 'r3', documentId: 'd1', parentId: 'r1', name: 'Diagrama v2', status: 'pending' }
      ]);
      const req = { user: WRITER, params: { documentId: 'd1' }, query: { search: 'diagrama', status: 'done' } };
      const res = mockRes();

      await getRules(req, res);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: [
          {
            _id: 'r1',
            documentId: 'd1',
            parentId: null,
            name: 'Root',
            status: 'pending',
            children: [
              { _id: 'r2', documentId: 'd1', parentId: 'r1', name: 'Diagrama', status: 'done', children: [] }
            ]
          }
        ]
      });
    });

    test('returns 404 when the owning project does not exist', async () => {
      Document.findById.mockResolvedValue({ _id: 'd1', projectId: 'p1' });
      Project.findById.mockResolvedValue(null);
      const req = { user: WRITER, params: { documentId: 'd1' } };
      const res = mockRes();

      await getRules(req, res);

      expect(Project.findById).toHaveBeenCalledWith('p1');
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'NOT_FOUND', message: 'Project not found' } });
    });

    test('returns 403 when the user is not a participant', async () => {
      Document.findById.mockResolvedValue({ _id: 'd1', projectId: 'p1' });
      Project.findById.mockResolvedValue({ _id: 'p1', participants: ['u2'] });
      const req = { user: OUTSIDER, params: { documentId: 'd1' } };
      const res = mockRes();

      await getRules(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'FORBIDDEN', message: 'No eres participante del proyecto' } });
    });

    test('returns 500 on unexpected error', async () => {
      Document.findById.mockRejectedValue(new Error('DB down'));
      const req = { user: WRITER, params: { documentId: 'd1' } };
      const res = mockRes();

      await getRules(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'INTERNAL_ERROR', message: 'DB down' } });
    });
  });

  describe('getRule', () => {
    test('returns 404 when rule does not exist', async () => {
      Rule.findById.mockResolvedValue(null);
      const req = { user: WRITER, params: { id: 'r1' } };
      const res = mockRes();

      await getRule(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'NOT_FOUND', message: 'Rule not found' } });
    });

    test('returns the rule with its sub-rules', async () => {
      Rule.findById.mockResolvedValue(withToObject({ _id: 'r1', documentId: 'd1', parentId: null, name: 'Root' }));
      mockRuleHierarchy([{ _id: 'r2', documentId: 'd1', parentId: 'r1', name: 'Child' }]);
      const req = { user: WRITER, params: { id: 'r1' } };
      const res = mockRes();

      await getRule(req, res);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: {
          _id: 'r1',
          documentId: 'd1',
          parentId: null,
          name: 'Root',
          children: [{ _id: 'r2', documentId: 'd1', parentId: 'r1', name: 'Child', children: [] }]
        }
      });
    });

    test('returns 404 when the owning document does not exist', async () => {
      Rule.findById.mockResolvedValue(withToObject({ _id: 'r3', documentId: 'd1', parentId: 'r2', name: 'Grandchild' }));
      Document.findById.mockResolvedValue(null);
      const req = { user: OUTSIDER, params: { id: 'r3' } };
      const res = mockRes();

      await getRule(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'NOT_FOUND', message: 'Document not found' } });
    });

    test('treats nested sub-rules at any depth with the same participation check', async () => {
      Rule.findById.mockResolvedValue(withToObject({ _id: 'r3', documentId: 'd1', parentId: 'r2', name: 'Grandchild' }));
      Document.findById.mockResolvedValue({ _id: 'd1', projectId: 'p1' });
      Project.findById.mockResolvedValue({ _id: 'p1', participants: ['u2'] });
      mockRuleHierarchy([]);
      const reqOutsider = { user: OUTSIDER, params: { id: 'r3' } };
      const resOutsider = mockRes();

      await getRule(reqOutsider, resOutsider);

      expect(resOutsider.status).toHaveBeenCalledWith(403);
      expect(resOutsider.json).toHaveBeenCalledWith({ success: false, error: { code: 'FORBIDDEN', message: 'No eres participante del proyecto' } });

      const reqParticipant = { user: PARTICIPANT, params: { id: 'r3' } };
      const resParticipant = mockRes();

      await getRule(reqParticipant, resParticipant);

      expect(resParticipant.json).toHaveBeenCalledWith({
        success: true,
        data: { _id: 'r3', documentId: 'd1', parentId: 'r2', name: 'Grandchild', children: [] }
      });
    });

    test('returns 500 on unexpected error', async () => {
      Rule.findById.mockRejectedValue(new Error('DB down'));
      const req = { user: WRITER, params: { id: 'r1' } };
      const res = mockRes();

      await getRule(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('createRule', () => {
    test('returns 404 when document does not exist', async () => {
      Document.findById.mockResolvedValue(null);
      const req = { user: WRITER, params: { documentId: 'd1' }, body: { name: 'Nueva' } };
      const res = mockRes();

      await createRule(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'NOT_FOUND', message: 'Document not found' } });
    });

    test('returns 400 when document is completed', async () => {
      Document.findById.mockResolvedValue({ _id: 'd1', status: 'done' });
      const req = { user: WRITER, params: { documentId: 'd1' }, body: { name: 'Nueva' } };
      const res = mockRes();

      await createRule(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: { code: 'DOCUMENT_COMPLETED', message: 'Cannot add rules to a completed document' }
      });
    });

    test('returns 400 when parentId does not exist', async () => {
      Document.findById.mockResolvedValue({ _id: 'd1', status: 'in_progress' });
      Rule.findById.mockResolvedValue(null);
      const req = { user: WRITER, params: { documentId: 'd1' }, body: { name: 'Sub', parentId: 'missing' } };
      const res = mockRes();

      await createRule(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: { code: 'INVALID_PARENT', message: 'Parent rule not found in this document' }
      });
    });

    test('returns 400 when parentId belongs to a different document', async () => {
      Document.findById.mockResolvedValue({ _id: 'd1', status: 'in_progress' });
      Rule.findById.mockResolvedValue({ _id: 'p1', documentId: 'd2' });
      const req = { user: WRITER, params: { documentId: 'd1' }, body: { name: 'Sub', parentId: 'p1' } };
      const res = mockRes();

      await createRule(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json.mock.calls[0][0].error.code).toBe('INVALID_PARENT');
    });

    test('returns 404 when the owning project does not exist', async () => {
      Document.findById.mockResolvedValue({ _id: 'd1', status: 'in_progress', projectId: 'p1' });
      Project.findById.mockResolvedValue(null);
      const req = { user: WRITER, params: { documentId: 'd1' }, body: { name: 'Nueva' } };
      const res = mockRes();

      await createRule(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'NOT_FOUND', message: 'Project not found' } });
    });

    test('returns 403 when the user is not a participant of the owning project', async () => {
      Document.findById.mockResolvedValue({ _id: 'd1', status: 'in_progress', projectId: 'p1' });
      Project.findById.mockResolvedValue({ _id: 'p1', participants: ['u2'] });
      const req = { user: OUTSIDER, params: { documentId: 'd1' }, body: { name: 'Nueva' } };
      const res = mockRes();

      await createRule(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'FORBIDDEN', message: 'No eres participante del proyecto' } });
    });

    test('creates a root rule (no parentId) with 201 status', async () => {
      Document.findById.mockResolvedValue({ _id: 'd1', status: 'in_progress', projectId: 'p1' });
      const req = { user: WRITER,
        params: { documentId: 'd1' },
        body: { name: 'Nueva Regla', type: 'text', required: true, deadline: '2026-12-31' }
      };
      const res = mockRes();

      await createRule(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      const saved = res.json.mock.calls[0][0];
      expect(saved.success).toBe(true);
      expect(saved.data.name).toBe('Nueva Regla');
      expect(saved.data.parentId).toBeNull();
      expect(saved.data.documentId).toBe('d1');
      expect(createEvent).toHaveBeenCalledWith('rule_created', { name: 'Nueva Regla', type: 'text', required: true, deadline: '2026-12-31' }, { projectId: 'p1', documentId: 'd1', ruleId: saved.data._id });
    });

    test('creates a sub-rule with a valid parentId', async () => {
      Document.findById.mockResolvedValue({ _id: 'd1', status: 'in_progress', projectId: 'p1' });
      Rule.findById.mockResolvedValue({ _id: 'p1', documentId: 'd1' });
      const req = { user: WRITER,
        params: { documentId: 'd1' },
        body: { name: 'Sub Regla', type: 'file', required: true, parentId: 'p1' }
      };
      const res = mockRes();

      await createRule(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json.mock.calls[0][0].data.parentId).toBe('p1');
    });

    test('returns 400 VALIDATION_ERROR on save failure', async () => {
      Document.findById.mockResolvedValue({ _id: 'd1', status: 'in_progress' });
      Rule.mockImplementationOnce(function (data) {
        Object.assign(this, data);
        this.save = jest.fn().mockRejectedValue(new Error('type is required'));
        return this;
      });
      const req = { user: WRITER, params: { documentId: 'd1' }, body: { name: 'Sin tipo' } };
      const res = mockRes();

      await createRule(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'type is required' }
      });
    });
  });

  describe('updateRule', () => {
    test('returns 404 when rule does not exist', async () => {
      Rule.findById.mockResolvedValue(null);
      const req = { user: WRITER, params: { id: 'r1' }, body: { name: 'x' } };
      const res = mockRes();

      await updateRule(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'NOT_FOUND', message: 'Rule not found' } });
    });

    test('returns 400 when rule is completed', async () => {
      Rule.findById.mockResolvedValue({ _id: 'r1', status: 'done', save: jest.fn() });
      const req = { user: WRITER, params: { id: 'r1' }, body: { name: 'x' } };
      const res = mockRes();

      await updateRule(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: { code: 'RULE_COMPLETED', message: 'Cannot modify completed rule' }
      });
    });

    test('returns 403 when the user is not a participant of the owning project', async () => {
      const rule = { _id: 'r1', status: 'pending', documentId: 'd1', save: jest.fn() };
      Rule.findById.mockResolvedValue(rule);
      Project.findById.mockResolvedValue({ _id: 'p1', participants: ['u2'] });
      const req = { user: OUTSIDER, params: { id: 'r1' }, body: { name: 'x' } };
      const res = mockRes();

      await updateRule(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'FORBIDDEN', message: 'No eres participante del proyecto' } });
      expect(rule.save).not.toHaveBeenCalled();
      expect(createEvent).not.toHaveBeenCalled();
    });

    test('updates the rule and emits rule_updated when status does not change', async () => {
      const rule = { _id: 'r1', status: 'pending', name: 'Old', documentId: 'd1', save: jest.fn().mockResolvedValue(true) };
      Rule.findById.mockResolvedValue(rule);
      Document.findById.mockResolvedValue({ _id: 'd1', projectId: 'p1' });
      const req = { user: WRITER, params: { id: 'r1' }, body: { name: 'New' } };
      const res = mockRes();

      await updateRule(req, res);

      expect(rule.name).toBe('New');
      expect(createEvent).toHaveBeenCalledWith('rule_updated', { name: 'New' }, { projectId: 'p1', documentId: 'd1', ruleId: 'r1' });
      expect(res.json).toHaveBeenCalledWith({ success: true, data: rule });
    });

    test('emits rule_status_changed when status changes', async () => {
      const rule = { _id: 'r1', status: 'pending', documentId: 'd1', save: jest.fn().mockResolvedValue(true) };
      Rule.findById.mockResolvedValue(rule);
      Document.findById.mockResolvedValue({ _id: 'd1', projectId: 'p1' });
      const req = { user: WRITER, params: { id: 'r1' }, body: { status: 'in_progress' } };
      const res = mockRes();

      await updateRule(req, res);

      expect(rule.status).toBe('in_progress');
      expect(createEvent).toHaveBeenCalledWith('rule_status_changed', { previousStatus: 'pending', newStatus: 'in_progress', reason: 'manual' }, { projectId: 'p1', documentId: 'd1', ruleId: 'r1' });
    });

    test('does not emit rule_status_changed when status is same', async () => {
      const rule = { _id: 'r1', status: 'pending', documentId: 'd1', save: jest.fn().mockResolvedValue(true) };
      Rule.findById.mockResolvedValue(rule);
      Document.findById.mockResolvedValue({ _id: 'd1', projectId: 'p1' });
      const req = { user: WRITER, params: { id: 'r1' }, body: { status: 'pending', name: 'Updated' } };
      const res = mockRes();

      await updateRule(req, res);

      expect(createEvent).toHaveBeenCalledWith('rule_updated', expect.objectContaining({ name: 'Updated' }), expect.any(Object));
      expect(createEvent).not.toHaveBeenCalledWith('rule_status_changed', expect.anything(), expect.anything());
    });

    test('returns 400 INVALID_TRANSITION on invalid status jump', async () => {
      const rule = { _id: 'r1', status: 'pending', save: jest.fn() };
      Rule.findById.mockResolvedValue(rule);
      const req = { user: WRITER, params: { id: 'r1' }, body: { status: 'cancelado' } };
      const res = mockRes();

      await updateRule(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: { code: 'INVALID_TRANSITION', message: 'Invalid status transition for rule: pending -> cancelado' }
      });
      expect(rule.save).not.toHaveBeenCalled();
    });

    test('returns 400 VALIDATION_ERROR on save failure', async () => {
      const rule = { _id: 'r1', status: 'pending', save: jest.fn().mockRejectedValue(new Error('invalid type')) };
      Rule.findById.mockResolvedValue(rule);
      const req = { user: WRITER, params: { id: 'r1' }, body: { type: 'invalid' } };
      const res = mockRes();

      await updateRule(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'invalid type' }
      });
    });
  });

  describe('changeRuleStatus', () => {
    test('returns 404 when rule does not exist', async () => {
      Rule.findById.mockResolvedValue(null);
      const req = { user: WRITER, params: { id: 'r1' }, body: { status: 'in_progress' } };
      const res = mockRes();

      await changeRuleStatus(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'NOT_FOUND', message: 'Rule not found' } });
    });

    test('returns 400 VALIDATION_ERROR when status is missing', async () => {
      Rule.findById.mockResolvedValue({ _id: 'r1', status: 'pending', save: jest.fn() });
      const req = { user: WRITER, params: { id: 'r1' }, body: {} };
      const res = mockRes();

      await changeRuleStatus(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'status is required' }
      });
    });

    test('returns 403 when the user is not a participant of the owning project', async () => {
      const rule = { _id: 'r1', status: 'pending', documentId: 'd1', save: jest.fn() };
      Rule.findById.mockResolvedValue(rule);
      Project.findById.mockResolvedValue({ _id: 'p1', participants: ['u2'] });
      const req = { user: OUTSIDER, params: { id: 'r1' }, body: { status: 'done' } };
      const res = mockRes();

      await changeRuleStatus(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'FORBIDDEN', message: 'No eres participante del proyecto' } });
      expect(rule.save).not.toHaveBeenCalled();
      expect(createEvent).not.toHaveBeenCalled();
    });

    test('reopens a done rule to in_progress and emits rule_status_changed', async () => {
      const rule = { _id: 'r1', status: 'done', documentId: 'd1', save: jest.fn().mockResolvedValue(true) };
      Rule.findById.mockResolvedValue(rule);
      Document.findById.mockResolvedValue({ _id: 'd1', projectId: 'p1' });
      const req = { user: WRITER, params: { id: 'r1' }, body: { status: 'in_progress' } };
      const res = mockRes();

      await changeRuleStatus(req, res);

      expect(rule.status).toBe('in_progress');
      expect(rule.save).toHaveBeenCalled();
      expect(createEvent).toHaveBeenCalledWith(
        'rule_status_changed',
        { previousStatus: 'done', newStatus: 'in_progress', reason: 'manual' },
        { projectId: 'p1', documentId: 'd1', ruleId: 'r1' }
      );
      expect(res.json).toHaveBeenCalledWith({ success: true, data: rule });
    });

    test('allows done -> done (no-op) without error', async () => {
      const rule = { _id: 'r1', status: 'done', documentId: 'd1', save: jest.fn().mockResolvedValue(true) };
      Rule.findById.mockResolvedValue(rule);
      Document.findById.mockResolvedValue({ _id: 'd1', projectId: 'p1' });
      const req = { user: WRITER, params: { id: 'r1' }, body: { status: 'done' } };
      const res = mockRes();

      await changeRuleStatus(req, res);

      expect(rule.status).toBe('done');
      expect(res.json).toHaveBeenCalledWith({ success: true, data: rule });
    });

    test('changes status and emits rule_status_changed with reason manual', async () => {
      const rule = { _id: 'r1', status: 'pending', documentId: 'd1', save: jest.fn().mockResolvedValue(true) };
      Rule.findById.mockResolvedValue(rule);
      Document.findById.mockResolvedValue({ _id: 'd1', projectId: 'p1' });
      const req = { user: WRITER, params: { id: 'r1' }, body: { status: 'done' } };
      const res = mockRes();

      await changeRuleStatus(req, res);

      expect(rule.status).toBe('done');
      expect(rule.save).toHaveBeenCalled();
      expect(createEvent).toHaveBeenCalledWith(
        'rule_status_changed',
        { previousStatus: 'pending', newStatus: 'done', reason: 'manual' },
        { projectId: 'p1', documentId: 'd1', ruleId: 'r1' }
      );
      expect(res.json).toHaveBeenCalledWith({ success: true, data: rule });
    });

    test('moves a pending rule to in_progress manually', async () => {
      const rule = { _id: 'r1', status: 'pending', documentId: 'd1', save: jest.fn().mockResolvedValue(true) };
      Rule.findById.mockResolvedValue(rule);
      Document.findById.mockResolvedValue({ _id: 'd1', projectId: 'p1' });
      const req = { user: WRITER, params: { id: 'r1' }, body: { status: 'in_progress' } };
      const res = mockRes();

      await changeRuleStatus(req, res);

      expect(rule.status).toBe('in_progress');
      expect(createEvent).toHaveBeenCalledWith(
        'rule_status_changed',
        { previousStatus: 'pending', newStatus: 'in_progress', reason: 'manual' },
        { projectId: 'p1', documentId: 'd1', ruleId: 'r1' }
      );
    });

    test('returns 400 INVALID_TRANSITION on in_progress to pending regression', async () => {
      const rule = { _id: 'r1', status: 'in_progress', save: jest.fn() };
      Rule.findById.mockResolvedValue(rule);
      const req = { user: WRITER, params: { id: 'r1' }, body: { status: 'pending' } };
      const res = mockRes();

      await changeRuleStatus(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: { code: 'INVALID_TRANSITION', message: 'Invalid status transition for rule: in_progress -> pending' }
      });
      expect(rule.save).not.toHaveBeenCalled();
    });

    test('returns 400 VALIDATION_ERROR on save failure', async () => {
      const rule = { _id: 'r1', status: 'pending', save: jest.fn().mockRejectedValue(new Error('invalid')) };
      Rule.findById.mockResolvedValue(rule);
      const req = { user: WRITER, params: { id: 'r1' }, body: { status: 'done' } };
      const res = mockRes();

      await changeRuleStatus(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'invalid' }
      });
    });
  });

  describe('deleteRule', () => {
    test('returns 404 when rule does not exist', async () => {
      Rule.findById.mockResolvedValue(null);
      const req = { user: WRITER, params: { id: 'r1' } };
      const res = mockRes();

      await deleteRule(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'NOT_FOUND', message: 'Rule not found' } });
    });

    test('returns 400 RULE_COMPLETED when the rule itself is done', async () => {
      Rule.findById.mockResolvedValue({ _id: 'r1', status: 'done', documentId: 'd1', name: 'Done Rule' });
      const req = { user: WRITER, params: { id: 'r1' } };
      const res = mockRes();

      await deleteRule(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: { code: 'RULE_COMPLETED', message: 'Cannot delete a completed rule' }
      });
    });

    test('returns 400 RULE_COMPLETED when a descendant sub-rule is done', async () => {
      Rule.findById.mockResolvedValue({ _id: 'r1', status: 'pending', documentId: 'd1', name: 'Parent Rule' });
      mockRuleHierarchy([{ _id: 'r2', documentId: 'd1', parentId: 'r1' }]);
      Rule.countDocuments.mockResolvedValue(1);
      const req = { user: WRITER, params: { id: 'r1' } };
      const res = mockRes();

      await deleteRule(req, res);

      expect(Rule.countDocuments).toHaveBeenCalledWith({ _id: { $in: ['r1', 'r2'] }, status: 'done' });
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: { code: 'RULE_COMPLETED', message: 'Cannot delete a rule containing completed sub-rules' }
      });
    });

    test('returns 403 when the user is not a participant of the owning project', async () => {
      Rule.findById.mockResolvedValue({ _id: 'r1', documentId: 'd1', name: 'Rule 1', status: 'pending' });
      Project.findById.mockResolvedValue({ _id: 'p1', participants: ['u2'] });
      const req = { user: OUTSIDER, params: { id: 'r1' } };
      const res = mockRes();

      await deleteRule(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'FORBIDDEN', message: 'No eres participante del proyecto' } });
      expect(Rule.deleteMany).not.toHaveBeenCalled();
      expect(createEvent).not.toHaveBeenCalled();
    });

    test('deletes a rule without sub-rules', async () => {
      Rule.findById.mockResolvedValue({ _id: 'r1', documentId: 'd1', name: 'Rule 1', status: 'pending' });
      Document.findById.mockResolvedValue({ _id: 'd1', projectId: 'p1' });
      mockRuleHierarchy([]);
      Rule.countDocuments.mockResolvedValue(0);
      Evidence.deleteMany.mockResolvedValue({});
      Rule.deleteMany.mockResolvedValue({});
      const req = { user: WRITER, params: { id: 'r1' } };
      const res = mockRes();

      await deleteRule(req, res);

      expect(Evidence.deleteMany).toHaveBeenCalledWith({ ruleId: { $in: ['r1'] } });
      expect(Rule.deleteMany).toHaveBeenCalledWith({ _id: { $in: ['r1'] } });
      expect(createEvent).toHaveBeenCalledWith('rule_deleted', { name: 'Rule 1', deletedCount: 1 }, { projectId: 'p1', documentId: 'd1', ruleId: 'r1' });
      expect(res.json).toHaveBeenCalledWith({ success: true, data: { _id: 'r1', deletedCount: 1 } });
    });

    test('recursively deletes a rule, its sub-rules and their evidences', async () => {
      Rule.findById.mockResolvedValue({ _id: 'r1', documentId: 'd1', name: 'Rule 1' });
      Document.findById.mockResolvedValue({ _id: 'd1', projectId: 'p1' });
      mockRuleHierarchy([
        { _id: 'r2', documentId: 'd1', parentId: 'r1', name: 'Child' },
        { _id: 'r3', documentId: 'd1', parentId: 'r2', name: 'Grandchild' }
      ]);
      Rule.countDocuments.mockResolvedValue(0);
      Evidence.deleteMany.mockResolvedValue({});
      Rule.deleteMany.mockResolvedValue({});
      const req = { user: WRITER, params: { id: 'r1' } };
      const res = mockRes();

      await deleteRule(req, res);

      expect(Evidence.deleteMany).toHaveBeenCalledWith({ ruleId: { $in: ['r1', 'r2', 'r3'] } });
      expect(Rule.deleteMany).toHaveBeenCalledWith({ _id: { $in: ['r1', 'r2', 'r3'] } });
      expect(createEvent).toHaveBeenCalledWith('rule_deleted', { name: 'Rule 1', deletedCount: 3 }, { projectId: 'p1', documentId: 'd1', ruleId: 'r1' });
      expect(res.json).toHaveBeenCalledWith({ success: true, data: { _id: 'r1', deletedCount: 3 } });
    });

    test('returns 500 INTERNAL_ERROR on unexpected error', async () => {
      Rule.findById.mockRejectedValue(new Error('DB down'));
      const req = { user: WRITER, params: { id: 'r1' } };
      const res = mockRes();

      await deleteRule(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: { code: 'INTERNAL_ERROR', message: 'DB down' } });
    });
  });
});

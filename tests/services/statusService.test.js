jest.mock('../../src/models/Rule', () => require('../mocks/mongooseModel')());
jest.mock('../../src/models/Evidence', () => require('../mocks/mongooseModel')());
jest.mock('../../src/services/eventSourcingService', () => ({
  createEvent: jest.fn().mockResolvedValue({})
}));

const Rule = require('../../src/models/Rule');
const Evidence = require('../../src/models/Evidence');
const { createEvent } = require('../../src/services/eventSourcingService');
const {
  TRANSITIONS,
  assertTransition,
  InvalidTransitionError,
  syncRuleStatusFromEvidences
} = require('../../src/services/statusService');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('TRANSITIONS map', () => {
  test('defines a terminal done state for project and document', () => {
    ['project', 'document'].forEach((entity) => {
      expect(TRANSITIONS[entity].done).toEqual([]);
    });
  });

  test('allows rule done to be reopened to in_progress', () => {
    expect(TRANSITIONS.rule.done).toEqual(['in_progress']);
  });

  test('defines unavailable as terminal for projects', () => {
    expect(TRANSITIONS.project.unavailable).toEqual([]);
  });
});

describe('assertTransition', () => {
  describe('valid transitions pass', () => {
    test.each([
      ['project', 'active', 'done'],
      ['project', 'active', 'paused'],
      ['project', 'paused', 'active'],
      ['document', 'pending', 'in_progress'],
      ['document', 'pending', 'done'],
      ['document', 'in_progress', 'done'],
      ['rule', 'pending', 'in_progress'],
      ['rule', 'pending', 'done'],
      ['rule', 'in_progress', 'done'],
      ['rule', 'done', 'in_progress']
    ])('%s: %s -> %s', (entityType, from, to) => {
      expect(() => assertTransition(entityType, from, to)).not.toThrow();
    });
  });

  describe('invalid transitions are rejected', () => {
    test.each([
      ['project', 'active', 'unavailable'],
      ['project', 'active', 'cancelado'],
      ['project', 'paused', 'done'],
      ['project', 'paused', 'unavailable'],
      ['project', 'done', 'active'],
      ['project', 'unavailable', 'active'],
      ['document', 'pending', 'paused'],
      ['document', 'done', 'pending'],
      ['document', 'done', 'in_progress'],
      ['document', 'in_progress', 'cancelado'],
      ['document', 'in_progress', 'pending'],
      ['rule', 'done', 'pending'],
      ['rule', 'in_progress', 'pending'],
      ['rule', 'pending', 'cancelado']
    ])('%s: %s -> %s', (entityType, from, to) => {
      expect(() => assertTransition(entityType, from, to)).toThrow(InvalidTransitionError);
    });
  });

  test('error carries the INVALID_TRANSITION code and descriptive message', () => {
    try {
      assertTransition('project', 'paused', 'done');
      throw new Error('expected assertTransition to throw');
    } catch (error) {
      expect(error.code).toBe('INVALID_TRANSITION');
      expect(error.message).toBe('Invalid status transition for project: paused -> done');
    }
  });

  test('unknown entity type rejects any transition', () => {
    expect(() => assertTransition('unknown', 'a', 'b')).toThrow(InvalidTransitionError);
  });

  test('does nothing when target status is not provided', () => {
    expect(() => assertTransition('project', 'paused', undefined)).not.toThrow();
    expect(() => assertTransition('project', 'paused', null)).not.toThrow();
  });

  test('does nothing when target equals current status', () => {
    expect(() => assertTransition('document', 'pending', 'pending')).not.toThrow();
  });
});

describe('syncRuleStatusFromEvidences', () => {
  test('returns null when rule does not exist', async () => {
    Rule.findById.mockResolvedValue(null);

    await expect(syncRuleStatusFromEvidences('r1')).resolves.toBeNull();
    expect(Evidence.countDocuments).not.toHaveBeenCalled();
  });

  test('moves a pending rule to in_progress when it receives evidence and emits event', async () => {
    const rule = { _id: 'r1', status: 'pending', save: jest.fn().mockResolvedValue(true) };
    Rule.findById.mockResolvedValue(rule);
    Evidence.countDocuments.mockResolvedValue(2);
    const context = { projectId: 'p1', documentId: 'd1', ruleId: 'r1' };

    const result = await syncRuleStatusFromEvidences('r1', 'evidence_sync', context);

    expect(Evidence.countDocuments).toHaveBeenCalledWith({ ruleId: 'r1' });
    expect(rule.status).toBe('in_progress');
    expect(rule.save).toHaveBeenCalled();
    expect(createEvent).toHaveBeenCalledWith(
      'rule_status_changed',
      { previousStatus: 'pending', newStatus: 'in_progress', reason: 'evidence_sync' },
      context
    );
    expect(result).toBe(rule);
  });

  test('keeps a pending rule untouched when it has no evidences', async () => {
    const rule = { _id: 'r1', status: 'pending', save: jest.fn() };
    Rule.findById.mockResolvedValue(rule);
    Evidence.countDocuments.mockResolvedValue(0);

    await syncRuleStatusFromEvidences('r1');

    expect(rule.status).toBe('pending');
    expect(rule.save).not.toHaveBeenCalled();
    expect(createEvent).not.toHaveBeenCalled();
  });

  test('keeps an in_progress rule in in_progress when evidences remain', async () => {
    const rule = { _id: 'r1', status: 'in_progress', save: jest.fn() };
    Rule.findById.mockResolvedValue(rule);
    Evidence.countDocuments.mockResolvedValue(3);

    await syncRuleStatusFromEvidences('r1');

    expect(rule.status).toBe('in_progress');
    expect(rule.save).not.toHaveBeenCalled();
    expect(createEvent).not.toHaveBeenCalled();
  });

  test('does not revert an in_progress rule when evidences are removed', async () => {
    const rule = { _id: 'r1', status: 'in_progress', save: jest.fn() };
    Rule.findById.mockResolvedValue(rule);
    Evidence.countDocuments.mockResolvedValue(0);

    await syncRuleStatusFromEvidences('r1');

    expect(rule.status).toBe('in_progress');
    expect(rule.save).not.toHaveBeenCalled();
    expect(createEvent).not.toHaveBeenCalled();
  });

  test('keeps a done rule untouched when evidences remain', async () => {
    const rule = { _id: 'r1', status: 'done', save: jest.fn() };
    Rule.findById.mockResolvedValue(rule);
    Evidence.countDocuments.mockResolvedValue(3);

    await syncRuleStatusFromEvidences('r1');

    expect(rule.status).toBe('done');
    expect(rule.save).not.toHaveBeenCalled();
    expect(createEvent).not.toHaveBeenCalled();
  });

  test('does not revert a done rule when evidences are removed', async () => {
    const rule = { _id: 'r1', status: 'done', save: jest.fn() };
    Rule.findById.mockResolvedValue(rule);
    Evidence.countDocuments.mockResolvedValue(0);

    await syncRuleStatusFromEvidences('r1');

    expect(rule.status).toBe('done');
    expect(rule.save).not.toHaveBeenCalled();
    expect(createEvent).not.toHaveBeenCalled();
  });
});

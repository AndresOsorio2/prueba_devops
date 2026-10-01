const Rule = require('../models/Rule');
const Evidence = require('../models/Evidence');
const { createEvent } = require('./eventSourcingService');

const TRANSITIONS = {
  project: {
    active: ['done', 'paused'],
    paused: ['active'],
    done: [],
    unavailable: []
  },
  document: {
    pending: ['in_progress', 'done'],
    in_progress: ['done'],
    done: []
  },
  rule: {
    pending: ['in_progress', 'done'],
    in_progress: ['done'],
    done: ['in_progress']
  }
};

class InvalidTransitionError extends Error {
  constructor(entityType, from, to) {
    super(`Invalid status transition for ${entityType}: ${from} -> ${to}`);
    this.name = 'InvalidTransitionError';
    this.code = 'INVALID_TRANSITION';
  }
}

const assertTransition = (entityType, from, to) => {
  if (!to || to === from) return;
  const allowed = (TRANSITIONS[entityType] || {})[from] || [];
  if (!allowed.includes(to)) {
    throw new InvalidTransitionError(entityType, from, to);
  }
};

const syncRuleStatusFromEvidences = async (ruleId, reason = 'evidence_sync', context = {}) => {
  const rule = await Rule.findById(ruleId);
  if (!rule) return null;

  const evidenceCount = await Evidence.countDocuments({ ruleId: rule._id });

  // Solo auto-transición: pending → in_progress al tener al menos una evidencia.
  // NUNCA hace done, NUNCA revierte (sin regresión).
  if (rule.status === 'pending' && evidenceCount > 0) {
    const previousStatus = rule.status;
    rule.status = 'in_progress';
    await rule.save();
    await createEvent('rule_status_changed', { previousStatus, newStatus: 'in_progress', reason }, context);
  }
  return rule;
};

module.exports = { TRANSITIONS, InvalidTransitionError, assertTransition, syncRuleStatusFromEvidences };

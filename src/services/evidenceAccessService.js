const Evidence = require('../models/Evidence');
const { resolveRuleWithAccess } = require('./ruleAccessService');
const { ERROR_CODES, MESSAGES } = require('../utils/messages');

async function resolveEvidenceWithAccess(user, evidenceId) {
  const evidence = await Evidence.findById(evidenceId);
  if (!evidence) {
    return { ok: false, status: 404, error: { code: ERROR_CODES.NOT_FOUND, message: MESSAGES.EVIDENCE_NOT_FOUND } };
  }

  const access = await resolveRuleWithAccess(user, evidence.ruleId);
  if (!access.ok) {
    return access;
  }

  return { ok: true, evidence, rule: access.rule, document: access.document, project: access.project };
}

module.exports = { resolveEvidenceWithAccess };

const Rule = require('../models/Rule');
const Document = require('../models/Document');
const Project = require('../models/Project');
const { hasProjectAccess } = require('./documentAccessService');
const { ERROR_CODES, MESSAGES } = require('../utils/messages');

async function resolveRuleWithAccess(user, ruleId) {
  const rule = await Rule.findById(ruleId);
  if (!rule) {
    return { ok: false, status: 404, error: { code: ERROR_CODES.NOT_FOUND, message: MESSAGES.RULE_NOT_FOUND } };
  }

  const document = await Document.findById(rule.documentId);
  if (!document) {
    return { ok: false, status: 404, error: { code: ERROR_CODES.NOT_FOUND, message: MESSAGES.DOCUMENT_NOT_FOUND } };
  }

  const project = await Project.findById(document.projectId);
  if (!project) {
    return { ok: false, status: 404, error: { code: ERROR_CODES.NOT_FOUND, message: MESSAGES.PROJECT_NOT_FOUND } };
  }

  if (!hasProjectAccess(user, project)) {
    return { ok: false, status: 403, error: { code: ERROR_CODES.FORBIDDEN, message: MESSAGES.NOT_A_PARTICIPANT } };
  }

  return { ok: true, rule, document, project };
}

module.exports = { resolveRuleWithAccess };
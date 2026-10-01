const Document = require('../models/Document');
const Rule = require('../models/Rule');
const Evidence = require('../models/Evidence');
const Project = require('../models/Project');
const { createEvent } = require('../services/eventSourcingService');
const { hasProjectAccess } = require('../services/documentAccessService');
const { resolveRuleWithAccess } = require('../services/ruleAccessService');
const { assertTransition, InvalidTransitionError } = require('../services/statusService');
const { ERROR_CODES, MESSAGES } = require('../utils/messages');
const { respondError, respondAccessError, respondInternalError } = require('../utils/respondError');

const buildRuleTree = async (documentId, parentId) => {
  const rules = await Rule.find({ documentId, parentId }).sort({ order: 1 });
  return Promise.all(rules.map(async (rule) => {
    const children = await buildRuleTree(documentId, rule._id);
    return { ...rule.toObject(), children };
  }));
};

const collectDescendantIds = async (documentId, parentId) => {
  const children = await Rule.find({ documentId, parentId });
  let ids = children.map((child) => child._id);
  for (const child of children) {
    ids = ids.concat(await collectDescendantIds(documentId, child._id));
  }
  return ids;
};

const getAllRules = async (documentId) => Rule.find({ documentId });

const matchesFilter = (rule, search, status) => {
  if (search) {
    const re = new RegExp(search, 'i');
    if (!re.test(rule.name) && !re.test(rule.description || '')) return false;
  }
  if (status && rule.status !== status) return false;
  return true;
};

const computeIncludedIds = (allRules, search, status) => {
  const ruleById = new Map(allRules.map((r) => [String(r._id), r]));
  const included = new Set();
  for (const rule of allRules) {
    if (matchesFilter(rule, search, status)) {
      let current = rule;
      while (current) {
        included.add(String(current._id));
        current = current.parentId ? ruleById.get(String(current.parentId)) : null;
      }
    }
  }
  return included;
};

const buildFilteredTree = (allRules, parentId, included) => {
  const children = allRules.filter(
    (r) => String(r.parentId || null) === String(parentId) && included.has(String(r._id))
  );
  return children.map((r) => ({ ...r.toObject(), children: buildFilteredTree(allRules, r._id, included) }));
};

const getRules = async (req, res) => {
  try {
    const document = await Document.findById(req.params.documentId);
    if (!document) {
      return respondError(res, 404, ERROR_CODES.NOT_FOUND, MESSAGES.DOCUMENT_NOT_FOUND);
    }

    const project = await Project.findById(document.projectId);
    if (!project) {
      return respondError(res, 404, ERROR_CODES.NOT_FOUND, MESSAGES.PROJECT_NOT_FOUND);
    }
    if (!hasProjectAccess(req.user, project)) {
      return respondError(res, 403, ERROR_CODES.FORBIDDEN, MESSAGES.NOT_A_PARTICIPANT);
    }

    const { search, status } = req.query || {};
    let tree;
    if (!search && !status) {
      tree = await buildRuleTree(document._id, null);
    } else {
      const allRules = await getAllRules(document._id);
      const included = computeIncludedIds(allRules, search, status);
      tree = buildFilteredTree(allRules, null, included);
    }

    res.json({ success: true, data: tree });
  } catch (error) {
    respondInternalError(res, error);
  }
};

const getRule = async (req, res) => {
  try {
    const access = await resolveRuleWithAccess(req.user, req.params.id);
    if (!access.ok) {
      return respondAccessError(res, access);
    }

    const rule = access.rule;
    const children = await buildRuleTree(rule.documentId, rule._id);
    res.json({ success: true, data: { ...rule.toObject(), children } });
  } catch (error) {
    respondInternalError(res, error);
  }
};

const createRule = async (req, res) => {
  try {
    const document = await Document.findById(req.params.documentId);
    if (!document) {
      return respondError(res, 404, ERROR_CODES.NOT_FOUND, MESSAGES.DOCUMENT_NOT_FOUND);
    }

    const project = await Project.findById(document.projectId);
    if (!project) {
      return respondError(res, 404, ERROR_CODES.NOT_FOUND, MESSAGES.PROJECT_NOT_FOUND);
    }
    if (!hasProjectAccess(req.user, project)) {
      return respondError(res, 403, ERROR_CODES.FORBIDDEN, MESSAGES.NOT_A_PARTICIPANT);
    }

    if (document.status === 'done') {
      return respondError(res, 400, 'DOCUMENT_COMPLETED', 'Cannot add rules to a completed document');
    }

    const { name, description, type, required, deadline, parentId, order, selectOptions, markdownContent, notify } = req.body;

    if (parentId) {
      const parentRule = await Rule.findById(parentId);
      if (!parentRule || String(parentRule.documentId) !== String(document._id)) {
        return respondError(res, 400, 'INVALID_PARENT', 'Parent rule not found in this document');
      }
    }

    const rule = new Rule({
      documentId: document._id,
      parentId: parentId || null,
      name,
      description,
      type,
      required,
      deadline,
      order,
      selectOptions,
      markdownContent,
      notify
    });
    await rule.save();

    await createEvent('rule_created', { name, type, required, deadline }, { projectId: document.projectId, documentId: document._id, ruleId: rule._id });

    res.status(201).json({ success: true, data: rule });
  } catch (error) {
    respondError(res, 400, ERROR_CODES.VALIDATION_ERROR, error.message);
  }
};

const updateRule = async (req, res) => {
  try {
    const access = await resolveRuleWithAccess(req.user, req.params.id);
    if (!access.ok) {
      return respondAccessError(res, access);
    }

    const rule = access.rule;
    const document = access.document;

    if (rule.status === 'done') {
      return respondError(res, 400, 'RULE_COMPLETED', 'Cannot modify completed rule');
    }

    assertTransition('rule', rule.status, req.body.status);

    const oldStatus = rule.status;
    Object.assign(rule, req.body);
    await rule.save();

    if (req.body.status && req.body.status !== oldStatus) {
      await createEvent('rule_status_changed', { previousStatus: oldStatus, newStatus: req.body.status, reason: 'manual' }, { projectId: document.projectId, documentId: rule.documentId, ruleId: rule._id });
    } else {
      await createEvent('rule_updated', req.body, { projectId: document.projectId, documentId: rule.documentId, ruleId: rule._id });
    }

    res.json({ success: true, data: rule });
  } catch (error) {
    if (error instanceof InvalidTransitionError) {
      return respondError(res, 400, 'INVALID_TRANSITION', error.message);
    }
    respondError(res, 400, ERROR_CODES.VALIDATION_ERROR, error.message);
  }
};

const changeRuleStatus = async (req, res) => {
  try {
    const access = await resolveRuleWithAccess(req.user, req.params.id);
    if (!access.ok) {
      return respondAccessError(res, access);
    }

    const rule = access.rule;
    const document = access.document;

    const newStatus = req.body.status;
    if (!newStatus || !['pending', 'in_progress', 'done'].includes(newStatus)) {
      return respondError(res, 400, ERROR_CODES.VALIDATION_ERROR, 'status is required');
    }

    assertTransition('rule', rule.status, newStatus);

    const oldStatus = rule.status;
    rule.status = newStatus;
    await rule.save();

    await createEvent('rule_status_changed', { previousStatus: oldStatus, newStatus, reason: 'manual' }, { projectId: document.projectId, documentId: rule.documentId, ruleId: rule._id });

    res.json({ success: true, data: rule });
  } catch (error) {
    if (error instanceof InvalidTransitionError) {
      return respondError(res, 400, 'INVALID_TRANSITION', error.message);
    }
    respondError(res, 400, ERROR_CODES.VALIDATION_ERROR, error.message);
  }
};

const deleteRule = async (req, res) => {
  try {
    const access = await resolveRuleWithAccess(req.user, req.params.id);
    if (!access.ok) {
      return respondAccessError(res, access);
    }

    const rule = access.rule;
    const document = access.document;

    if (rule.status === 'done') {
      return respondError(res, 400, 'RULE_COMPLETED', 'Cannot delete a completed rule');
    }

    const descendantIds = await collectDescendantIds(rule.documentId, rule._id);
    const allIds = [rule._id, ...descendantIds];

    const completedDescendants = await Rule.countDocuments({ _id: { $in: allIds }, status: 'done' });
    if (completedDescendants > 0) {
      return respondError(res, 400, 'RULE_COMPLETED', 'Cannot delete a rule containing completed sub-rules');
    }

    await Evidence.deleteMany({ ruleId: { $in: allIds } });
    await Rule.deleteMany({ _id: { $in: allIds } });

    await createEvent('rule_deleted', { name: rule.name, deletedCount: allIds.length }, { projectId: document.projectId, documentId: rule.documentId, ruleId: rule._id });

    res.json({ success: true, data: { _id: rule._id, deletedCount: allIds.length } });
  } catch (error) {
    respondInternalError(res, error);
  }
};

module.exports = { getRules, getRule, createRule, updateRule, changeRuleStatus, deleteRule, buildRuleTree, collectDescendantIds };

const express = require('express');
const router = express.Router();
const { requirePermission } = require('../middleware/requirePermission');
const { getRules, getRule, createRule, updateRule, changeRuleStatus, deleteRule } = require('../controllers/ruleController');

// Mounted at /api/documents
router.get('/:documentId/rules', requirePermission('rule:read'), getRules);
router.post('/:documentId/rules', requirePermission('rule:write'), createRule);

// Mounted at /api/rules
router.get('/:id', requirePermission('rule:read'), getRule);
router.put('/:id', requirePermission('rule:write'), updateRule);
router.patch('/:id/status', requirePermission('rule:write'), changeRuleStatus);
router.delete('/:id', requirePermission('rule:write'), deleteRule);

module.exports = router;

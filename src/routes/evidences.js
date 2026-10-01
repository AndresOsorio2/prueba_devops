const express = require('express');
const router = express.Router();
const { requirePermission } = require('../middleware/requirePermission');
const { getEvidences, createEvidence, deleteEvidence, downloadEvidence } = require('../controllers/evidenceController');

// Mounted at /api/rules
router.get('/:ruleId/evidences', requirePermission('evidence:read'), getEvidences);
router.post('/:ruleId/evidences', requirePermission('evidence:write'), createEvidence);

// Mounted at /api/evidences
router.get('/:id/download', requirePermission('evidence:read'), downloadEvidence);
router.delete('/:id', requirePermission('evidence:write'), deleteEvidence);

module.exports = router;

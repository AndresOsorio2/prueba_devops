const express = require('express');
const router = express.Router();
const { requirePermission } = require('../middleware/requirePermission');
const { getTemplates, getTemplateById, createTemplate, updateTemplate, deleteTemplate, applyTemplate } = require('../controllers/templateController');

router.get('/', requirePermission('template:read'), getTemplates);
router.get('/:id', requirePermission('template:read'), getTemplateById);
router.post('/', requirePermission('template:write'), createTemplate);
router.put('/:id', requirePermission('template:write'), updateTemplate);
router.delete('/:id', requirePermission('template:write'), deleteTemplate);
router.post('/:id/apply', requirePermission('template:write'), applyTemplate);

module.exports = router;
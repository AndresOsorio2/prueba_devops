const express = require('express');
const router = express.Router();
const { requirePermission } = require('../middleware/requirePermission');
const { getDocuments, getDocument, createDocument, updateDocument, deleteDocument, generateAiReport } = require('../controllers/documentController');
const { getDocumentReport, updateDocumentReport } = require('../controllers/documentReportController');
const { saveDocumentAsTemplate } = require('../controllers/templateController');
const { setDocumentResponsible, clearDocumentResponsible } = require('../controllers/documentResponsibleController');

// Mounted at /api/projects
router.get('/:projectId/documents', requirePermission('document:read'), getDocuments);
router.post('/:projectId/documents', requirePermission('document:write'), createDocument);

// Mounted at /api/documents
router.get('/:id', requirePermission('document:read'), getDocument);
router.put('/:id', requirePermission('document:write'), updateDocument);
router.delete('/:id', requirePermission('document:write'), deleteDocument);
router.put('/:id/responsible', requirePermission('document:responsible'), setDocumentResponsible);
router.delete('/:id/responsible', requirePermission('document:responsible'), clearDocumentResponsible);
router.get('/:id/report', requirePermission('document:read'), getDocumentReport);
router.put('/:id/report', requirePermission('document:write'), updateDocumentReport);
router.post('/:id/report/generate-ai', requirePermission('document:write'), generateAiReport);
router.post('/:id/save-as-template', requirePermission('document:write'), requirePermission('template:write'), saveDocumentAsTemplate);

module.exports = router;
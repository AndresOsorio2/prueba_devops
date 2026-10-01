const { generateDocumentReportMarkdown } = require('../services/reportService');
const { createEvent } = require('../services/eventSourcingService');
const { resolveDocumentWithAccess } = require('../services/documentAccessService');
const { ERROR_CODES, MESSAGES } = require('../utils/messages');
const { respondError, respondAccessError, respondInternalError } = require('../utils/respondError');

const getDocumentReport = async (req, res) => {
  try {
    const access = await resolveDocumentWithAccess(req.user, req.params.id);
    if (!access.ok) {
      return respondAccessError(res, access);
    }
    const document = access.document;

    const regenerate = req.query.regenerate === 'true';

    if (regenerate) {
      if (document.status === 'done') {
        return respondError(res, 400, 'DOCUMENT_COMPLETED', MESSAGES.DOCUMENT_COMPLETED);
      }

      const { markdown, generatedAt } = await generateDocumentReportMarkdown(document._id);
      document.reportMarkdown = markdown;
      document.reportEditedAt = generatedAt;
      await document.save();
      await createEvent('report_generated', { regenerated: true }, { projectId: document.projectId, documentId: document._id });

      return res.json({ success: true, data: { markdown, generatedAt, source: 'regenerated' } });
    }

    if (document.reportMarkdown) {
      return res.json({
        success: true,
        data: { markdown: document.reportMarkdown, generatedAt: document.reportEditedAt, source: 'edited' }
      });
    }

    const { markdown, generatedAt } = await generateDocumentReportMarkdown(document._id);
    res.json({ success: true, data: { markdown, generatedAt, source: 'auto' } });
  } catch (error) {
    respondInternalError(res, error);
  }
};

const updateDocumentReport = async (req, res) => {
  try {
    const access = await resolveDocumentWithAccess(req.user, req.params.id);
    if (!access.ok) {
      return respondAccessError(res, access);
    }
    const document = access.document;

    if (document.status === 'done') {
      return respondError(res, 400, 'DOCUMENT_COMPLETED', MESSAGES.DOCUMENT_COMPLETED);
    }

    const { markdown } = req.body;
    if (typeof markdown !== 'string' || !markdown.trim()) {
      return respondError(res, 400, ERROR_CODES.VALIDATION_ERROR, 'markdown is required');
    }

    document.reportMarkdown = markdown;
    document.reportEditedAt = new Date();
    await document.save();

    await createEvent('report_edited', { size: markdown.length }, { projectId: document.projectId, documentId: document._id });

    res.json({
      success: true,
      data: {
        _id: document._id,
        name: document.name,
        reportMarkdown: document.reportMarkdown,
        reportEditedAt: document.reportEditedAt
      }
    });
  } catch (error) {
    respondInternalError(res, error);
  }
};

module.exports = { getDocumentReport, updateDocumentReport };

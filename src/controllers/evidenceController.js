const path = require('path');
const fs = require('fs');
const Document = require('../models/Document');
const Evidence = require('../models/Evidence');
const { upload } = require('../middleware/upload');
const { createEvent } = require('../services/eventSourcingService');
const { syncRuleStatusFromEvidences } = require('../services/statusService');
const { resolveRuleWithAccess } = require('../services/ruleAccessService');
const { resolveEvidenceWithAccess } = require('../services/evidenceAccessService');
const { ERROR_CODES } = require('../utils/messages');
const { respondError, respondAccessError, respondInternalError } = require('../utils/respondError');

const getEvidences = async (req, res) => {
  try {
    const access = await resolveRuleWithAccess(req.user, req.params.ruleId);
    if (!access.ok) {
      return respondAccessError(res, access);
    }

    const rule = access.rule;
    const evidences = await Evidence.find({ ruleId: rule._id }).sort({ createdAt: 1 });
    res.json({ success: true, data: evidences });
  } catch (error) {
    respondInternalError(res, error);
  }
};

const createFileEvidence = (rule, req, res) => {
  upload.single('file')(req, res, async (err) => {
    try {
      if (err) {
        if (err.message === 'INVALID_FILE_TYPE') {
          return respondError(res, 400, 'INVALID_FILE_TYPE', 'File type not allowed');
        }
        if (err.code === 'LIMIT_FILE_SIZE') {
          return respondError(res, 400, 'FILE_TOO_LARGE', 'File exceeds maximum allowed size');
        }
        return respondError(res, 400, ERROR_CODES.VALIDATION_ERROR, err.message);
      }

      if (!req.file) {
        return respondError(res, 400, ERROR_CODES.VALIDATION_ERROR, 'File is required');
      }

      const evidence = new Evidence({
        ruleId: rule._id,
        type: 'file',
        value: path.relative(process.cwd(), req.file.path),
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size
      });
      await evidence.save();

      const doc = await Document.findById(rule.documentId);
      const context = { projectId: doc.projectId, documentId: rule.documentId, ruleId: rule._id };
      await createEvent('evidence_added', { ruleId: rule._id, evidenceId: evidence._id, type: 'file', fileName: evidence.originalName }, context);
      await syncRuleStatusFromEvidences(rule._id, 'evidence_sync', context);

      res.status(201).json({ success: true, data: evidence });
    } catch (error) {
      // Catches multer callback errors too, so a rejected promise never crashes the process (fire-and-forget callback)
      respondError(res, 400, ERROR_CODES.VALIDATION_ERROR, error.message);
    }
  });
};

const createEvidence = async (req, res) => {
  try {
    const access = await resolveRuleWithAccess(req.user, req.params.ruleId);
    if (!access.ok) {
      return respondAccessError(res, access);
    }

    const rule = access.rule;
    if (rule.status === 'done') {
      return respondError(res, 400, 'RULE_COMPLETED', 'Cannot add evidence to a completed rule');
    }

    const contentType = req.headers['content-type'] || '';
    if (contentType.includes('multipart/form-data')) {
      return createFileEvidence(rule, req, res);
    }

    const { type, value } = req.body;
    const evidence = new Evidence({ ruleId: rule._id, type, value });
    await evidence.save();

    const doc = await Document.findById(rule.documentId);
    const context = { projectId: doc.projectId, documentId: rule.documentId, ruleId: rule._id };
    await createEvent('evidence_added', { ruleId: rule._id, evidenceId: evidence._id, type, value }, context);
    await syncRuleStatusFromEvidences(rule._id, 'evidence_sync', context);

    res.status(201).json({ success: true, data: evidence });
  } catch (error) {
    respondError(res, 400, ERROR_CODES.VALIDATION_ERROR, error.message);
  }
};

const deleteEvidence = async (req, res) => {
  try {
    const access = await resolveEvidenceWithAccess(req.user, req.params.id);
    if (!access.ok) {
      return respondAccessError(res, access);
    }

    const evidence = access.evidence;
    if (evidence.type === 'file') {
      const filePath = path.resolve(process.cwd(), evidence.value);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    await Evidence.findByIdAndDelete(evidence._id);

    const context = { projectId: access.project._id, documentId: access.document._id, ruleId: access.rule._id };
    await createEvent('evidence_deleted', { ruleId: access.rule._id, evidenceId: evidence._id, type: evidence.type }, context);
    await syncRuleStatusFromEvidences(access.rule._id, 'evidence_sync', context);

    res.json({ success: true, data: { deleted: true } });
  } catch (error) {
    respondInternalError(res, error);
  }
};

const downloadEvidence = async (req, res) => {
  try {
    const access = await resolveEvidenceWithAccess(req.user, req.params.id);
    if (!access.ok) {
      return respondAccessError(res, access);
    }

    const evidence = access.evidence;
    if (evidence.type !== 'file') {
      return respondError(res, 404, ERROR_CODES.NOT_FOUND, 'Evidence file not found');
    }

    const filePath = path.resolve(process.cwd(), evidence.value);
    if (!fs.existsSync(filePath)) {
      return respondError(res, 404, ERROR_CODES.NOT_FOUND, 'File not found on disk');
    }

    res.download(filePath, evidence.originalName);
  } catch (error) {
    respondInternalError(res, error);
  }
};

module.exports = { getEvidences, createEvidence, deleteEvidence, downloadEvidence };

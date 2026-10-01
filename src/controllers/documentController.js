const Project = require('../models/Project');
const Document = require('../models/Document');
const Rule = require('../models/Rule');
const { createEvent } = require('../services/eventSourcingService');
const { assertTransition, InvalidTransitionError } = require('../services/statusService');
const { generateDocumentSection } = require('../services/aiReportService');
const { saveTemplateFromSnapshot, TemplateNameExistsError } = require('../services/templateService');
const { hasProjectAccess, resolveDocumentWithAccess } = require('../services/documentAccessService');
const { serializeDocument, serializeDocuments } = require('../services/documentSerializer');

const logger = require('../logger/seqLogger');
const { ERROR_CODES, MESSAGES } = require('../utils/messages');
const { parsePagination } = require('../utils/pagination');
const { respondError, respondAccessError, respondInternalError } = require('../utils/respondError');

const EDITABLE_FIELDS = ['name', 'description', 'deadline', 'order'];

const getDocuments = async (req, res) => {
  try {
    const project = await Project.findById(req.params.projectId);
    if (!project) {
      return respondError(res, 404, ERROR_CODES.NOT_FOUND, MESSAGES.PROJECT_NOT_FOUND);
    }

    if (!hasProjectAccess(req.user, project)) {
      return respondError(res, 403, ERROR_CODES.FORBIDDEN, MESSAGES.NOT_A_PARTICIPANT);
    }

    const { search, status } = req.query || {};
    const query = { projectId: project._id };
    if (status) query.status = status;
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    const { enabled, page, limit } = parsePagination(req.query || {});

    let documents;
    let pagination;

    if (enabled) {
      const total = await Document.countDocuments(query);
      const totalPages = Math.ceil(total / limit);
      documents = await Document.find(query).sort({ order: 1 }).skip((page - 1) * limit).limit(limit);
      pagination = { page, limit, total, totalPages };
    } else {
      documents = await Document.find(query).sort({ order: 1 });
    }

    const documentsWithStats = await Promise.all(documents.map(async (document) => {
      const ruleCount = await Rule.countDocuments({ documentId: document._id });
      const completedRules = await Rule.countDocuments({ documentId: document._id, status: 'done' });

      return { ...document.toObject(), ruleCount, completedRules };
    }));

    const serialized = await serializeDocuments(documentsWithStats);

    if (enabled) {
      res.json({ success: true, data: serialized, pagination });
    } else {
      res.json({ success: true, data: serialized });
    }
  } catch (error) {
    respondInternalError(res, error);
  }
};

const getDocument = async (req, res) => {
  try {
    const access = await resolveDocumentWithAccess(req.user, req.params.id);
    if (!access.ok) {
      return respondAccessError(res, access);
    }
    const document = access.document;

    const rules = await Rule.find({ documentId: document._id }).sort({ order: 1 });
    res.json({ success: true, data: await serializeDocument(document, { rules }) });
  } catch (error) {
    respondInternalError(res, error);
  }
};

const createDocument = async (req, res) => {
  try {
    const project = await Project.findById(req.params.projectId);
    if (!project) {
      return respondError(res, 404, ERROR_CODES.NOT_FOUND, MESSAGES.PROJECT_NOT_FOUND);
    }

    if (!hasProjectAccess(req.user, project)) {
      return respondError(res, 403, ERROR_CODES.FORBIDDEN, MESSAGES.NOT_A_PARTICIPANT);
    }

    if (project.status === 'done' || project.status === 'unavailable') {
      return respondError(res, 400, 'PROJECT_COMPLETED', MESSAGES.PROJECT_CLOSED);
    }

    const { name, description, deadline, order, saveAsTemplate } = req.body;
    const document = new Document({ projectId: project._id, name, description, deadline, order });
    await document.save();

    await createEvent('document_created', { name, description, deadline, order }, { projectId: project._id, documentId: document._id });

    if (saveAsTemplate === true) {
      try {
        await saveTemplateFromSnapshot({ name: document.name, description: document.description, items: [] });
      } catch (error) {
        if (error instanceof TemplateNameExistsError) {
          return res.status(201).json({ success: true, data: document, templateWarning: error.message });
        }
        logger.warn('🟡 saveAsTemplate skipped', { error: error.message, documentId: document._id, name: document.name });
      }
    }

    res.status(201).json({ success: true, data: document });
  } catch (error) {
    respondError(res, 400, ERROR_CODES.VALIDATION_ERROR, error.message);
  }
};

const updateDocument = async (req, res) => {
  try {
    const access = await resolveDocumentWithAccess(req.user, req.params.id);
    if (!access.ok) {
      return respondAccessError(res, access);
    }
    const document = access.document;

    if (document.status === 'done') {
      return respondError(res, 400, 'DOCUMENT_COMPLETED', MESSAGES.DOCUMENT_COMPLETED);
    }

    assertTransition('document', document.status, req.body.status);

    const oldStatus = document.status;
    const editable = {};
    for (const field of EDITABLE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        editable[field] = req.body[field];
      }
    }
    Object.assign(document, editable);

    if (req.body.status && req.body.status !== oldStatus) {
      document.status = req.body.status;
    }
    await document.save();

    if (req.body.status && req.body.status !== oldStatus) {
      await createEvent('document_status_changed', { previousStatus: oldStatus, newStatus: req.body.status, reason: 'manual' }, { projectId: document.projectId, documentId: document._id });
    } else {
      await createEvent('document_updated', editable, { projectId: document.projectId, documentId: document._id });
    }

    res.json({ success: true, data: document });
  } catch (error) {
    if (error instanceof InvalidTransitionError) {
      return respondError(res, 400, 'INVALID_TRANSITION', error.message);
    }
    respondError(res, 400, ERROR_CODES.VALIDATION_ERROR, error.message);
  }
};

const deleteDocument = async (req, res) => {
  try {
    const access = await resolveDocumentWithAccess(req.user, req.params.id);
    if (!access.ok) {
      return respondAccessError(res, access);
    }
    const document = access.document;

    if (document.status === 'done') {
      return respondError(res, 400, 'DOCUMENT_COMPLETED', 'Cannot delete a completed document');
    }

    const completedRules = await Rule.countDocuments({ documentId: document._id, status: 'done' });
    if (completedRules > 0) {
      return respondError(res, 400, 'DOCUMENT_COMPLETED', 'Cannot delete a document containing completed rules');
    }

    await Rule.deleteMany({ documentId: document._id });
    await document.deleteOne();

    await createEvent('document_deleted', { name: document.name }, { projectId: document.projectId, documentId: document._id });

    res.json({ success: true, data: { _id: document._id } });
  } catch (error) {
    respondInternalError(res, error);
  }
};

const generateAiReport = async (req, res) => {
  try {
    const access = await resolveDocumentWithAccess(req.user, req.params.id);
    if (!access.ok) {
      return respondAccessError(res, access);
    }
    const document = access.document;

    const { instructions } = req.body || {};
    const result = await generateDocumentSection(document._id, { instructions });

    res.json({ success: true, data: result });
  } catch (error) {
    if (error.code === 'NO_CONTENT') {
      return respondError(res, 400, 'NO_CONTENT', error.message);
    }
    if (error.code === 'AI_CONFIG_MISSING') {
      return respondError(res, 500, 'AI_CONFIG_MISSING', error.message);
    }
    if (error.code === 'AI_PROVIDER_ERROR') {
      return respondError(res, 502, 'AI_PROVIDER_ERROR', error.message);
    }
    respondInternalError(res, error);
  }
};

module.exports = { getDocuments, getDocument, createDocument, updateDocument, deleteDocument, generateAiReport };

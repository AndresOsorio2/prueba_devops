const mongoose = require('mongoose');
const Project = require('../models/Project');
const User = require('../models/User');
const { createEvent } = require('../services/eventSourcingService');
const { resolveDocumentWithAccess } = require('../services/documentAccessService');
const { serializeDocument, RESPONSIBLE_PROJECTION } = require('../services/documentSerializer');
const { ERROR_CODES, MESSAGES } = require('../utils/messages');
const { respondError, respondAccessError, respondInternalError } = require('../utils/respondError');

const idOf = (value) => (value === null || value === undefined ? null : String(value));

const resolveResponsibleContext = async (req) => {
  const access = await resolveDocumentWithAccess(req.user, req.params.id);
  if (!access.ok) {
    return { ok: false, status: access.status, error: access.error };
  }

  const project = await Project.findById(access.document.projectId);
  if (project.status === 'done' || project.status === 'unavailable') {
    return {
      ok: false,
      status: 400,
      error: {
        code: 'PROJECT_COMPLETED',
        message: 'Cannot change the responsible of a completed or unavailable project'
      }
    };
  }

  return { ok: true, document: access.document, project };
};

const setDocumentResponsible = async (req, res) => {
  try {
    const context = await resolveResponsibleContext(req);
    if (!context.ok) {
      return respondAccessError(res, context);
    }

    const { document, project } = context;
    const { userId } = req.body || {};
    if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) {
      return respondError(res, 400, ERROR_CODES.VALIDATION_ERROR, 'userId debe ser un ObjectId válido');
    }

    const candidate = await User.findById(userId).select(RESPONSIBLE_PROJECTION);
    if (!candidate) {
      return respondError(res, 404, ERROR_CODES.NOT_FOUND, 'User not found');
    }

    const isParticipant = Array.isArray(project.participants)
      && project.participants.some((id) => String(id) === String(userId));
    if (!isParticipant) {
      return respondError(res, 400, ERROR_CODES.VALIDATION_ERROR, MESSAGES.RESPONSIBLE_MUST_BE_PARTICIPANT);
    }

    const previousResponsible = idOf(document.responsible);
    const newResponsible = String(userId);
    document.responsible = userId;
    await document.save();

    if (previousResponsible !== newResponsible) {
      await createEvent(
        'document_responsible_changed',
        { previousResponsible, newResponsible },
        { projectId: project._id, documentId: document._id }
      );
    }

    res.json({ success: true, data: await serializeDocument(document) });
  } catch (error) {
    respondInternalError(res, error);
  }
};

const clearDocumentResponsible = async (req, res) => {
  try {
    const context = await resolveResponsibleContext(req);
    if (!context.ok) {
      return respondAccessError(res, context);
    }

    const { document, project } = context;
    const previousResponsible = idOf(document.responsible);
    document.responsible = null;
    await document.save();

    if (previousResponsible) {
      await createEvent(
        'document_responsible_changed',
        { previousResponsible, newResponsible: null },
        { projectId: project._id, documentId: document._id }
      );
    }

    res.json({ success: true, data: await serializeDocument(document) });
  } catch (error) {
    respondInternalError(res, error);
  }
};

module.exports = { setDocumentResponsible, clearDocumentResponsible };

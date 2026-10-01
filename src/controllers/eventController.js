const Project = require('../models/Project');
const { getProjectEvents, getProjectTimeline } = require('../services/eventSourcingService');
const { hasProjectAccess } = require('../services/documentAccessService');
const { ERROR_CODES, MESSAGES } = require('../utils/messages');
const { parseOffsetLimit } = require('../utils/pagination');
const { respondError, respondInternalError } = require('../utils/respondError');

const getEvents = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) {
      return respondError(res, 404, ERROR_CODES.NOT_FOUND, MESSAGES.PROJECT_NOT_FOUND);
    }

    if (!hasProjectAccess(req.user, project)) {
      return respondError(res, 403, ERROR_CODES.FORBIDDEN, MESSAGES.NOT_A_PARTICIPANT);
    }

    const { limit, offset } = parseOffsetLimit(req.query);
    const { eventType } = req.query;
    const events = await getProjectEvents(req.params.id, { limit: parseInt(limit), offset: parseInt(offset), eventType });

    res.json({ success: true, data: events });
  } catch (error) {
    respondInternalError(res, error);
  }
};

const getTimeline = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) {
      return respondError(res, 404, ERROR_CODES.NOT_FOUND, MESSAGES.PROJECT_NOT_FOUND);
    }

    if (!hasProjectAccess(req.user, project)) {
      return respondError(res, 403, ERROR_CODES.FORBIDDEN, MESSAGES.NOT_A_PARTICIPANT);
    }

    const timeline = await getProjectTimeline(req.params.id);
    res.json({ success: true, data: timeline });
  } catch (error) {
    respondInternalError(res, error);
  }
};

module.exports = { getEvents, getTimeline };

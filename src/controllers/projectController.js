const mongoose = require('mongoose');
const Project = require('../models/Project');
const Document = require('../models/Document');
const Rule = require('../models/Rule');
const Evidence = require('../models/Evidence');
const Event = require('../models/Event');
const { createEvent } = require('../services/eventSourcingService');
const { assertTransition, InvalidTransitionError } = require('../services/statusService');
const { visibleProjectFilter, hasProjectAccess } = require('../services/documentAccessService');
const { ERROR_CODES, MESSAGES } = require('../utils/messages');
const { parsePagination } = require('../utils/pagination');
const { respondError, respondInternalError } = require('../utils/respondError');

const EDITABLE_FIELDS = ['name', 'description', 'priority', 'deadline'];

const getProjects = async (req, res) => {
  try {
    const { search, status, priority, sort = 'deadline', order = 'asc' } = req.query || {};
    const query = {};
    if (status) query.status = status;
    if (priority) query.priority = priority;
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }
    Object.assign(query, visibleProjectFilter(req.user));

    const { enabled, page, limit } = parsePagination(req.query || {});
    const sortQuery = { [sort]: order === 'desc' ? -1 : 1 };

    let projects;
    let pagination;

    if (enabled) {
      const total = await Project.countDocuments(query);
      const totalPages = Math.ceil(total / limit);
      projects = await Project.find(query).sort(sortQuery).skip((page - 1) * limit).limit(limit);
      pagination = { page, limit, total, totalPages };
    } else {
      projects = await Project.find(query).sort(sortQuery);
    }

    // Agregar conteos (solo para los items de la pagina en modo paginado)
    const projectsWithStats = await Promise.all(projects.map(async (project) => {
      const documents = await Document.find({ projectId: project._id });
      const docIds = documents.map(d => d._id);
      const totalRules = await Rule.countDocuments({ documentId: { $in: docIds } });
      const completedRules = await Rule.countDocuments({ documentId: { $in: docIds }, status: 'done' });

      return {
        ...project.toObject(),
        documentCount: documents.length,
        totalRules,
        completedRules
      };
    }));

    if (enabled) {
      res.json({ success: true, data: projectsWithStats, pagination });
    } else {
      res.json({ success: true, data: projectsWithStats });
    }
  } catch (error) {
    respondInternalError(res, error);
  }
};

const getProject = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) {
      return respondError(res, 404, ERROR_CODES.NOT_FOUND, MESSAGES.PROJECT_NOT_FOUND);
    }

    if (!hasProjectAccess(req.user, project)) {
      return respondError(res, 403, ERROR_CODES.FORBIDDEN, MESSAGES.NOT_A_PARTICIPANT);
    }

    const documents = await Document.find({ projectId: project._id }).sort({ order: 1 });
    res.json({ success: true, data: { ...project.toObject(), documents } });
  } catch (error) {
    respondInternalError(res, error);
  }
};

const addParticipants = async (req, res) => {
  try {
    const { userIds } = req.body || {};
    if (!Array.isArray(userIds)) {
      return respondError(res, 400, ERROR_CODES.VALIDATION_ERROR, 'userIds debe ser un array');
    }
    if (!userIds.every((id) => mongoose.Types.ObjectId.isValid(String(id)))) {
      return respondError(res, 400, ERROR_CODES.VALIDATION_ERROR, 'Todos los userIds deben ser ObjectId válidos');
    }

    const project = await Project.findById(req.params.id);
    if (!project) {
      return respondError(res, 404, ERROR_CODES.NOT_FOUND, MESSAGES.PROJECT_NOT_FOUND);
    }

    const existing = new Set((project.participants || []).map((id) => String(id)));
    const added = [];
    for (const rawId of userIds) {
      const id = String(rawId);
      if (!existing.has(id)) {
        existing.add(id);
        added.push(id);
      }
    }
    project.participants = [...(project.participants || []), ...added];
    await project.save();

    await createEvent('project_participant_added', { participants: added }, { projectId: project._id });

    res.json({ success: true, data: { participants: project.participants } });
  } catch (error) {
    respondInternalError(res, error);
  }
};

const removeParticipant = async (req, res) => {
  try {
    const { userId } = req.params || {};
    if (!mongoose.Types.ObjectId.isValid(String(userId))) {
      return respondError(res, 400, ERROR_CODES.VALIDATION_ERROR, 'userId debe ser ObjectId válido');
    }

    const project = await Project.findById(req.params.id);
    if (!project) {
      return respondError(res, 404, ERROR_CODES.NOT_FOUND, MESSAGES.PROJECT_NOT_FOUND);
    }

    project.participants = (project.participants || []).filter((id) => String(id) !== String(userId));
    await project.save();

    await createEvent('project_participant_removed', { userId }, { projectId: project._id });

    res.json({ success: true, data: { participants: project.participants } });
  } catch (error) {
    respondInternalError(res, error);
  }
};

const createProject = async (req, res) => {
  try {
    const { name, description, priority, deadline } = req.body;
    const project = new Project({ name, description, priority, deadline });
    await project.save();

    await createEvent('project_created', { name, priority, deadline }, { projectId: project._id });

    res.status(201).json({ success: true, data: project });
  } catch (error) {
    respondError(res, 400, ERROR_CODES.VALIDATION_ERROR, error.message);
  }
};

const updateProject = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) {
      return respondError(res, 404, ERROR_CODES.NOT_FOUND, MESSAGES.PROJECT_NOT_FOUND);
    }

    if (project.status === 'done') {
      return respondError(res, 400, 'PROJECT_COMPLETED', 'Cannot modify completed project');
    }

    const editable = {};
    for (const field of EDITABLE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        editable[field] = req.body[field];
      }
    }
    Object.assign(project, editable);
    await project.save();

    await createEvent('project_updated', editable, { projectId: project._id });

    res.json({ success: true, data: project });
  } catch (error) {
    respondError(res, 400, ERROR_CODES.VALIDATION_ERROR, error.message);
  }
};

const deleteProject = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) {
      return respondError(res, 404, ERROR_CODES.NOT_FOUND, MESSAGES.PROJECT_NOT_FOUND);
    }

    if (project.status === 'unavailable') {
      return respondError(res, 400, 'PROJECT_UNAVAILABLE', 'Project is already unavailable');
    }

    const oldStatus = project.status;
    project.status = 'unavailable';
    await project.save();

    await createEvent('project_status_changed', { previousStatus: oldStatus, newStatus: 'unavailable' }, { projectId: project._id });

    res.json({ success: true, data: project });
  } catch (error) {
    respondInternalError(res, error);
  }
};

/**
 * Cambia el estado del proyecto entre active | done | paused (PATCH /:id/status,
 * feature 124). Valida el salto contra TRANSITIONS.project (statusService.js:4-9) con
 * assertTransition, la misma regla que ya gobierna documento y regla. `unavailable` NO
 * está en el whitelist: el soft-delete de DELETE /:id conserva un único camino (D-002).
 */
const changeProjectStatus = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) {
      return respondError(res, 404, ERROR_CODES.NOT_FOUND, MESSAGES.PROJECT_NOT_FOUND);
    }

    const newStatus = req.body.status;
    if (!newStatus || !['active', 'done', 'paused'].includes(newStatus)) {
      return respondError(res, 400, ERROR_CODES.VALIDATION_ERROR, 'status must be one of active, done, paused');
    }

    assertTransition('project', project.status, newStatus);

    const previousStatus = project.status;
    project.status = newStatus;
    await project.save();

    await createEvent('project_status_changed', { previousStatus, newStatus, reason: 'manual' }, { projectId: project._id });

    res.json({ success: true, data: project });
  } catch (error) {
    if (error instanceof InvalidTransitionError) {
      return respondError(res, 400, 'INVALID_TRANSITION', error.message);
    }
    respondInternalError(res, error);
  }
};

module.exports = { getProjects, getProject, createProject, updateProject, deleteProject, addParticipants, removeParticipant, changeProjectStatus };

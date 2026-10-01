const Template = require('../models/Template');
const Document = require('../models/Document');
const Project = require('../models/Project');
const { createEvent } = require('../services/eventSourcingService');
const { buildItemsFromRules, saveTemplateFromSnapshot, materializeTemplateItems, TemplateNameExistsError } = require('../services/templateService');
const { resolveDocumentWithAccess } = require('../services/documentAccessService');
const { ERROR_CODES, MESSAGES } = require('../utils/messages');
const { respondError, respondAccessError, respondInternalError } = require('../utils/respondError');

const EDITABLE_FIELDS = ['name', 'description', 'items'];

const nestRules = (rules, parentId = null) =>
  rules
    .filter((rule) => String(rule.parentId || null) === String(parentId || null))
    .map((rule) => ({ ...rule.toObject(), children: nestRules(rules, rule._id) }));

const applyTemplate = async (req, res) => {
  try {
    const template = await Template.findById(req.params.id);
    if (!template) {
      return respondError(res, 404, ERROR_CODES.NOT_FOUND, MESSAGES.TEMPLATE_NOT_FOUND);
    }

    const project = await Project.findById(req.body.projectId);
    if (!project) {
      return respondError(res, 404, ERROR_CODES.NOT_FOUND, MESSAGES.PROJECT_NOT_FOUND);
    }

    if (project.status === 'done' || project.status === 'unavailable') {
      return respondError(res, 400, 'PROJECT_COMPLETED', MESSAGES.PROJECT_CLOSED);
    }

    if (!req.body.deadline) {
      return respondError(res, 400, ERROR_CODES.VALIDATION_ERROR, 'deadline is required');
    }

    const document = new Document({
      projectId: project._id,
      name: req.body.name || template.name,
      description: template.description,
      deadline: req.body.deadline,
      order: 0
    });
    await document.save();

    await createEvent('document_created', { name: document.name, description: document.description, deadline: document.deadline, order: document.order }, { projectId: project._id, documentId: document._id });

    const rules = await materializeTemplateItems({ documentId: document._id, parentId: null, items: template.items });
    for (const rule of rules) {
      await createEvent('rule_created', { name: rule.name, type: rule.type, required: rule.required }, { projectId: project._id, documentId: document._id, ruleId: rule._id });
    }

    res.status(201).json({ success: true, data: { ...document.toObject(), rules: nestRules(rules) } });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return respondError(res, 400, ERROR_CODES.VALIDATION_ERROR, error.message);
    }
    respondInternalError(res, error);
  }
};

const updateTemplate = async (req, res) => {
  try {
    const template = await Template.findById(req.params.id);
    if (!template) {
      return respondError(res, 404, ERROR_CODES.NOT_FOUND, MESSAGES.TEMPLATE_NOT_FOUND);
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'name')) {
      const conflict = await Template.findOne({ name: req.body.name, _id: { $ne: template._id } });
      if (conflict) {
        throw new TemplateNameExistsError(req.body.name);
      }
    }

    const editable = {};
    for (const field of EDITABLE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        editable[field] = req.body[field];
      }
    }
    Object.assign(template, editable);

    try {
      await template.save();
    } catch (error) {
      if (error.code === 11000) {
        throw new TemplateNameExistsError(template.name);
      }
      throw error;
    }

    res.json({ success: true, data: template });
  } catch (error) {
    if (error instanceof TemplateNameExistsError) {
      return respondError(res, 409, error.code, error.message);
    }
    if (error.name === 'ValidationError') {
      return respondError(res, 400, ERROR_CODES.VALIDATION_ERROR, error.message);
    }
    respondInternalError(res, error);
  }
};

const createTemplate = async (req, res) => {
  try {
    if (!req.body.name) {
      return respondError(res, 400, ERROR_CODES.VALIDATION_ERROR, 'name is required');
    }
    const template = await saveTemplateFromSnapshot({
      name: req.body.name,
      description: req.body.description,
      items: req.body.items || []
    });
    res.status(201).json({ success: true, data: template });
  } catch (error) {
    if (error instanceof TemplateNameExistsError) {
      return respondError(res, 409, error.code, error.message);
    }
    if (error.name === 'ValidationError') {
      return respondError(res, 400, ERROR_CODES.VALIDATION_ERROR, error.message);
    }
    respondInternalError(res, error);
  }
};

const deleteTemplate = async (req, res) => {
  try {
    const template = await Template.findById(req.params.id);
    if (!template) {
      return respondError(res, 404, ERROR_CODES.NOT_FOUND, MESSAGES.TEMPLATE_NOT_FOUND);
    }

    await template.deleteOne();

    res.json({ success: true, data: { _id: template._id } });
  } catch (error) {
    respondInternalError(res, error);
  }
};

const saveDocumentAsTemplate = async (req, res) => {
  try {
    const access = await resolveDocumentWithAccess(req.user, req.params.id);
    if (!access.ok) {
      return respondAccessError(res, access);
    }
    const document = access.document;

    const items = await buildItemsFromRules(document._id);
    const template = await saveTemplateFromSnapshot({
      name: document.name,
      description: document.description,
      items
    });

    res.status(201).json({ success: true, data: template });
  } catch (error) {
    if (error instanceof TemplateNameExistsError) {
      return respondError(res, 409, error.code, error.message);
    }
    respondInternalError(res, error);
  }
};

const getTemplates = async (req, res) => {
  try {
    const templates = await Template.aggregate([
      { $project: { name: 1, description: 1, itemCount: { $size: '$items' } } },
      { $sort: { name: 1 } }
    ]);
    res.json({ success: true, data: templates });
  } catch (error) {
    respondInternalError(res, error);
  }
};

const getTemplateById = async (req, res) => {
  try {
    const template = await Template.findById(req.params.id);
    if (!template) {
      return respondError(res, 404, ERROR_CODES.NOT_FOUND, MESSAGES.TEMPLATE_NOT_FOUND);
    }
    res.json({ success: true, data: template });
  } catch (error) {
    respondInternalError(res, error);
  }
};

module.exports = { getTemplates, getTemplateById, createTemplate, updateTemplate, deleteTemplate, applyTemplate, saveDocumentAsTemplate };
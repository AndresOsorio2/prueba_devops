const Project = require('../models/Project');
const Document = require('../models/Document');
const Rule = require('../models/Rule');
const { respondInternalError } = require('../utils/respondError');
const { visibleProjectFilter } = require('../services/documentAccessService');

function emptyStats() {
  return {
    totalProjects: 0,
    activeProjects: 0,
    completedProjects: 0,
    pausedProjects: 0,
    totalDocuments: 0,
    totalRules: 0,
    completedRules: 0,
    pendingRules: 0,
    projectsByPriority: { alta: 0, media: 0, baja: 0 }
  };
}

async function getGlobalStats() {
  const totalProjects = await Project.countDocuments({ status: { $ne: 'unavailable' } });
  const activeProjects = await Project.countDocuments({ status: 'active' });
  const completedProjects = await Project.countDocuments({ status: 'done' });
  const pausedProjects = await Project.countDocuments({ status: 'paused' });

  const totalDocuments = await Document.countDocuments();

  const totalRules = await Rule.countDocuments();
  const completedRules = await Rule.countDocuments({ status: 'done' });
  const pendingRules = await Rule.countDocuments({ status: 'pending' });

  const projectsByPriority = {
    alta: await Project.countDocuments({ priority: 'alta', status: { $ne: 'unavailable' } }),
    media: await Project.countDocuments({ priority: 'media', status: { $ne: 'unavailable' } }),
    baja: await Project.countDocuments({ priority: 'baja', status: { $ne: 'unavailable' } })
  };

  return {
    totalProjects,
    activeProjects,
    completedProjects,
    pausedProjects,
    totalDocuments,
    totalRules,
    completedRules,
    pendingRules,
    projectsByPriority
  };
}

async function getScopedStats(scope) {
  const stats = emptyStats();

  stats.totalProjects = await Project.countDocuments({ status: { $ne: 'unavailable' }, ...scope });
  stats.activeProjects = await Project.countDocuments({ status: 'active', ...scope });
  stats.completedProjects = await Project.countDocuments({ status: 'done', ...scope });
  stats.pausedProjects = await Project.countDocuments({ status: 'paused', ...scope });

  stats.projectsByPriority.alta = await Project.countDocuments({ priority: 'alta', status: { $ne: 'unavailable' }, ...scope });
  stats.projectsByPriority.media = await Project.countDocuments({ priority: 'media', status: { $ne: 'unavailable' }, ...scope });
  stats.projectsByPriority.baja = await Project.countDocuments({ priority: 'baja', status: { $ne: 'unavailable' }, ...scope });

  // D-109: los ids se resuelven solo por participacion, sin excluir los proyectos
  // unavailable. Asi los conteos de proyectos conservan el filtro por status de siempre
  // y los de documentos y reglas heredan la misma asimetria que ya tenia el endpoint.
  const projects = await Project.find(scope, '_id').lean();
  if (projects.length === 0) {
    return stats;
  }

  const documents = await Document.find({ projectId: { $in: projects.map((project) => project._id) } }, '_id').lean();
  if (documents.length === 0) {
    stats.totalDocuments = 0;
    return stats;
  }

  const documentIds = documents.map((document) => document._id);
  stats.totalDocuments = documentIds.length;
  stats.totalRules = await Rule.countDocuments({ documentId: { $in: documentIds } });
  stats.completedRules = await Rule.countDocuments({ documentId: { $in: documentIds }, status: 'done' });
  stats.pendingRules = await Rule.countDocuments({ documentId: { $in: documentIds }, status: 'pending' });

  return stats;
}

const getStats = async (req, res) => {
  try {
    const scope = visibleProjectFilter(req.user);
    const data = Object.keys(scope).length === 0
      ? await getGlobalStats()
      : await getScopedStats(scope);

    res.json({ success: true, data });
  } catch (error) {
    respondInternalError(res, error);
  }
};

const getAlerts = async (req, res) => {
  try {
    const { days = 7 } = req.query;
    const parsedDays = parseInt(days);
    const daysNum = Number.isNaN(parsedDays) ? 7 : parsedDays;
    const now = new Date();
    const futureDate = new Date(now.getTime() + daysNum * 24 * 60 * 60 * 1000);

    const projects = await Project.find({ status: { $ne: 'unavailable' }, ...visibleProjectFilter(req.user) });
    const overdue = [];
    const upcoming = [];

    for (const project of projects) {
      if (project.deadline < now) {
        overdue.push({
          type: 'project',
          id: project._id,
          name: project.name,
          projectName: project.name,
          deadline: project.deadline,
          daysOverdue: Math.ceil((now - project.deadline) / (1000 * 60 * 60 * 24)),
          required: true
        });
      } else if (project.deadline <= futureDate) {
        upcoming.push({
          type: 'project',
          id: project._id,
          name: project.name,
          deadline: project.deadline,
          daysUntilDeadline: Math.ceil((project.deadline - now) / (1000 * 60 * 60 * 24)),
          priority: project.priority
        });
      }

      const documents = await Document.find({ projectId: project._id });
      for (const doc of documents) {
        if (doc.deadline < now) {
          overdue.push({
            type: 'document',
            id: doc._id,
            name: doc.name,
            projectName: project.name,
            deadline: doc.deadline,
            daysOverdue: Math.ceil((now - doc.deadline) / (1000 * 60 * 60 * 24)),
            required: true
          });
        } else if (doc.deadline <= futureDate) {
          upcoming.push({
            type: 'document',
            id: doc._id,
            name: doc.name,
            projectName: project.name,
            deadline: doc.deadline,
            daysUntilDeadline: Math.ceil((doc.deadline - now) / (1000 * 60 * 60 * 24))
          });
        }

        const rules = await Rule.find({ documentId: doc._id, deadline: { $exists: true, $ne: null } });
        for (const rule of rules) {
          if (rule.deadline < now) {
            overdue.push({
              type: 'rule',
              id: rule._id,
              name: rule.name,
              projectName: project.name,
              deadline: rule.deadline,
              daysOverdue: Math.ceil((now - rule.deadline) / (1000 * 60 * 60 * 24)),
              required: rule.required
            });
          } else if (rule.deadline <= futureDate) {
            upcoming.push({
              type: 'rule',
              id: rule._id,
              name: rule.name,
              projectName: project.name,
              deadline: rule.deadline,
              daysUntilDeadline: Math.ceil((rule.deadline - now) / (1000 * 60 * 60 * 24))
            });
          }
        }
      }
    }

    overdue.sort((a, b) => a.deadline - b.deadline);
    upcoming.sort((a, b) => a.deadline - b.deadline);

    res.json({ success: true, data: { overdue, upcoming } });
  } catch (error) {
    respondInternalError(res, error);
  }
};

module.exports = { getStats, getAlerts };

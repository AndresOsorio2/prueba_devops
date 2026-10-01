const Project = require('../models/Project');
const Document = require('../models/Document');
const { hasPermission } = require('../middleware/requirePermission');
const { ERROR_CODES, MESSAGES } = require('../utils/messages');

function hasProjectAccess(user, project) {
  if (hasPermission(user, 'project:write')) {
    return true;
  }
  return Boolean(user && user._id)
    && Array.isArray(project && project.participants)
    && project.participants.some((id) => String(id) === String(user._id));
}

/**
 * Filtro de alcance para listados de proyectos (D-107).
 * Quien tiene project:write ve el panorama global; el resto solo lo que participa.
 * Devuelve un objeto vacio en vez de null para poder hacer spread sobre una query existente.
 */
function visibleProjectFilter(user) {
  if (!user || !user._id) {
    return {};
  }
  if (hasPermission(user, 'project:write')) {
    return {};
  }
  return { participants: user._id };
}

async function resolveDocumentWithAccess(user, documentId) {
  const document = await Document.findById(documentId);
  if (!document) {
    return { ok: false, status: 404, error: { code: ERROR_CODES.NOT_FOUND, message: MESSAGES.DOCUMENT_NOT_FOUND } };
  }

  const project = await Project.findById(document.projectId);
  if (!project) {
    return { ok: false, status: 404, error: { code: ERROR_CODES.NOT_FOUND, message: MESSAGES.PROJECT_NOT_FOUND } };
  }

  if (!hasProjectAccess(user, project)) {
    return { ok: false, status: 403, error: { code: ERROR_CODES.FORBIDDEN, message: MESSAGES.NOT_A_PARTICIPANT } };
  }

  return { ok: true, document };
}

module.exports = { hasProjectAccess, visibleProjectFilter, resolveDocumentWithAccess };

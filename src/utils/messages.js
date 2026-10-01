const ERROR_CODES = {
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  FORBIDDEN: 'FORBIDDEN',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  INTERNAL_ERROR: 'INTERNAL_ERROR'
};

const MESSAGES = {
  PROJECT_NOT_FOUND: 'Project not found',
  DOCUMENT_NOT_FOUND: 'Document not found',
  TEMPLATE_NOT_FOUND: 'Template not found',
  RULE_NOT_FOUND: 'Rule not found',
  EVIDENCE_NOT_FOUND: 'Evidence not found',
  NOT_A_PARTICIPANT: 'No eres participante del proyecto',
  RESPONSIBLE_MUST_BE_PARTICIPANT: 'El usuario debe agregarse primero como participante del proyecto',
  AUTHENTICATION_REQUIRED: 'Autenticación requerida',
  SESSION_EXPIRED: 'Sesión inválida o expirada',
  DOCUMENT_COMPLETED: 'Cannot modify completed document',
  PROJECT_CLOSED: 'Cannot add documents to a completed or unavailable project',
  INTERNAL_SERVER_ERROR: 'Internal server error',
  PERMISSION_REQUIRED: (permission) => `Permiso requerido: ${permission}`
};

module.exports = { ERROR_CODES, MESSAGES };

const { PERMISSIONS } = require('../models/permissions');
const { ERROR_CODES, MESSAGES } = require('../utils/messages');
const { respondError } = require('../utils/respondError');

class InvalidPermissionError extends Error {
  constructor(permission) {
    super(`Permiso inválido: "${permission}" no está en el catálogo de permisos`);
    this.name = 'InvalidPermissionError';
  }
}

function hasPermission(user, permission) {
  if (typeof permission !== 'string' || !PERMISSIONS.includes(permission)) {
    throw new InvalidPermissionError(permission);
  }
  return Boolean(user) && Array.isArray(user.permissions) && user.permissions.includes(permission);
}

function requirePermission(permission) {
  if (typeof permission !== 'string' || !PERMISSIONS.includes(permission)) {
    throw new InvalidPermissionError(permission);
  }

  return function authorize(req, res, next) {
    if (!req.user) {
      return respondError(res, 401, ERROR_CODES.UNAUTHORIZED, MESSAGES.AUTHENTICATION_REQUIRED);
    }
    if (!hasPermission(req.user, permission)) {
      return respondError(res, 403, ERROR_CODES.FORBIDDEN, MESSAGES.PERMISSION_REQUIRED(permission));
    }
    return next();
  };
}

module.exports = { requirePermission, hasPermission, InvalidPermissionError };
const logger = require('../logger/seqLogger');
const { ERROR_CODES } = require('./messages');

function respondError(res, status, code, message) {
  return res.status(status).json({ success: false, error: { code, message } });
}

function respondAccessError(res, access) {
  return respondError(res, access.status, access.error.code, access.error.message);
}

function respondInternalError(res, error) {
  logger.error('🔴 Internal server error', { error: error.message });
  return respondError(res, 500, ERROR_CODES.INTERNAL_ERROR, error.message);
}

module.exports = { respondError, respondAccessError, respondInternalError };

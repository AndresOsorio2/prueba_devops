const User = require('../models/User');
const { COOKIE_NAME, verifyToken } = require('../services/tokenService');
const { ERROR_CODES, MESSAGES } = require('../utils/messages');
const { respondError } = require('../utils/respondError');

function toPlainUser(user) {
  if (user && typeof user.toJSON === 'function') {
    return user.toJSON();
  }
  const copy = { ...user };
  delete copy.passwordHash;
  return copy;
}

async function authenticate(req, res, next) {
  try {
    const token = req.cookies && req.cookies[COOKIE_NAME];
    if (!token) {
      return respondError(res, 401, ERROR_CODES.UNAUTHENTICATED, MESSAGES.AUTHENTICATION_REQUIRED);
    }

    let payload;
    try {
      payload = await verifyToken(token);
    } catch (err) {
      return respondError(res, 401, ERROR_CODES.UNAUTHENTICATED, MESSAGES.SESSION_EXPIRED);
    }

    const user = await User.findById(payload.sub);
    if (!user || !user.active) {
      return respondError(res, 401, ERROR_CODES.UNAUTHENTICATED, MESSAGES.SESSION_EXPIRED);
    }

    req.user = toPlainUser(user);
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = authenticate;
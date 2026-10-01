const Joi = require('joi');
const User = require('../models/User');
const {
  verifyPassword,
  validatePasswordPolicy,
  hashPassword,
  PasswordPolicyError
} = require('../services/passwordService');
const { COOKIE_NAME, signToken, buildCookieOptions } = require('../services/tokenService');
const { createEvent } = require('../services/eventSourcingService');

const logger = require('../logger/seqLogger');
const { ERROR_CODES, MESSAGES } = require('../utils/messages');
const { respondError } = require('../utils/respondError');

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required()
});

const changePasswordSchema = Joi.object({
  currentPassword: Joi.string().required(),
  newPassword: Joi.string().required()
}).unknown(false);

function recordEventSilently(eventType, payload) {
  return createEvent(eventType, payload, {}).catch((error) => {
    logger.warn(`Evento de auditoría no registrado: ${eventType}`, { error: error.message });
  });
}

const login = async (req, res, next, options = {}) => {
  try {
    const { error: validationError, value } = loginSchema.validate(req.body || {});
    if (validationError) {
      return respondError(res, 400, ERROR_CODES.VALIDATION_ERROR, validationError.details[0].message);
    }

    const { email, password } = value;
    const user = await User.findOne({ email });

    if (!user) {
      await recordEventSilently('user_login_failed', { email });
      return respondError(res, 401, 'INVALID_CREDENTIALS', 'Credenciales inválidas');
    }

    if (!user.active) {
      await recordEventSilently('user_login_failed', { email, userId: user._id });
      return respondError(res, 403, 'ACCOUNT_DISABLED', 'Cuenta deshabilitada');
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      await recordEventSilently('user_login_failed', { email, userId: user._id });
      return respondError(res, 401, 'INVALID_CREDENTIALS', 'Credenciales inválidas');
    }

    const token = await signToken(user._id);
    res.cookie(COOKIE_NAME, token, buildCookieOptions());
    if (typeof options.resetLoginAttempts === 'function') {
      options.resetLoginAttempts();
    }
    await recordEventSilently('user_login_succeeded', { userId: user._id, email: user.email });
    return res.json({
      success: true,
      data: { user: user.toJSON(), mustChangePassword: user.mustChangePassword }
    });
  } catch (err) {
    return next(err);
  }
};

const changePassword = async (req, res, next) => {
  try {
    const { error: validationError, value } = changePasswordSchema.validate(req.body || {});
    if (validationError) {
      return respondError(res, 400, ERROR_CODES.VALIDATION_ERROR, validationError.details[0].message);
    }

    if (!req.user || !req.user._id) {
      return respondError(res, 401, ERROR_CODES.UNAUTHENTICATED, MESSAGES.AUTHENTICATION_REQUIRED);
    }

    const { currentPassword, newPassword } = value;
    const user = await User.findById(req.user._id);
    if (!user || !user.active) {
      return respondError(res, 401, ERROR_CODES.UNAUTHENTICATED, MESSAGES.SESSION_EXPIRED);
    }

    const valid = await verifyPassword(currentPassword, user.passwordHash);
    if (!valid) {
      return respondError(res, 400, 'INVALID_CURRENT_PASSWORD', 'La contraseña actual es incorrecta');
    }

    try {
      validatePasswordPolicy(newPassword);
    } catch (err) {
      if (err instanceof PasswordPolicyError) {
        return respondError(res, 400, ERROR_CODES.VALIDATION_ERROR, err.message);
      }
      throw err;
    }

    user.passwordHash = await hashPassword(newPassword);
    user.mustChangePassword = false;
    await user.save();

    await recordEventSilently('user_password_changed', { userId: user._id });

    return res.json({
      success: true,
      data: { user: user.toJSON(), mustChangePassword: user.mustChangePassword }
    });
  } catch (err) {
    return next(err);
  }
};

const getMe = (req, res) => {
  return res.json({ success: true, data: { user: req.user } });
};

const logout = (req, res) => {
  res.clearCookie(COOKIE_NAME, { path: '/' });
  return res.json({ success: true });
};

module.exports = { login, changePassword, getMe, logout };
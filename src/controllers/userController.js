const Joi = require('joi');
const mongoose = require('mongoose');
const User = require('../models/User');
const { PERMISSIONS } = require('../models/permissions');
const { validatePasswordPolicy, hashPassword, PasswordPolicyError, generateProvisionalPassword } = require('../services/passwordService');
const { isEmailAllowed } = require('../services/domainService');
const { importUsers: runBulkImport } = require('../services/userImportService');
const { createEvent } = require('../services/eventSourcingService');
const { ERROR_CODES } = require('../utils/messages');
const { respondError } = require('../utils/respondError');
const {
  PROFILE_FIELDS,
  normalizeProfileValue,
  profileJoiSchema
} = require('../utils/userDisplay');

const createUserSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required(),
  permissions: Joi.array().items(Joi.string().valid(...PERMISSIONS)).default([])
}).concat(profileJoiSchema()).unknown(false);

const statusSchema = Joi.object({
  active: Joi.boolean().required()
}).unknown(false);

// D-113: el PATCH acepta solo los tres campos de perfil y exige al menos uno,
// para que un cuerpo vacio no se confunda con un no-op silencioso.
const profileSchema = profileJoiSchema().min(1).unknown(false);

const importSchema = Joi.object({
  users: Joi.array().items(Joi.object()).required()
}).unknown(false);

const createUser = async (req, res, next) => {
  try {
    const { error: validationError, value } = createUserSchema.validate(req.body || {});
    if (validationError) {
      return respondError(res, 400, ERROR_CODES.VALIDATION_ERROR, validationError.details[0].message);
    }

    if (!isEmailAllowed(value.email)) {
      return respondError(res, 400, 'EMAIL_DOMAIN_NOT_ALLOWED', 'El dominio del correo no está permitido');
    }

    try {
      validatePasswordPolicy(value.password);
    } catch (err) {
      if (err instanceof PasswordPolicyError) {
        return respondError(res, 400, ERROR_CODES.VALIDATION_ERROR, err.message);
      }
      throw err;
    }

    const passwordHash = await hashPassword(value.password);
    const user = await User.create({
      email: value.email,
      passwordHash,
      permissions: value.permissions,
      active: true,
      mustChangePassword: true,
      firstName: normalizeProfileValue(value.firstName),
      lastName: normalizeProfileValue(value.lastName),
      jobTitle: normalizeProfileValue(value.jobTitle)
    });

    await createEvent('user_created', { userId: user._id, email: user.email }, {});

    return res.status(201).json({ success: true, data: { user: user.toJSON() } });
  } catch (err) {
    if (err && err.code === 11000) {
      return respondError(res, 409, 'EMAIL_ALREADY_EXISTS', 'El email ya está registrado');
    }
    return next(err);
  }
};

const listUsers = async (req, res, next) => {
  try {
    const users = await User.find().sort({ email: 1 });
    return res.json({ success: true, data: users.map((user) => user.toJSON()) });
  } catch (err) {
    return next(err);
  }
};

const updateUserStatus = async (req, res, next) => {
  try {
    const { error: validationError, value } = statusSchema.validate(req.body || {});
    if (validationError) {
      return respondError(res, 400, ERROR_CODES.VALIDATION_ERROR, validationError.details[0].message);
    }

    const id = req.params.id;
    if (!mongoose.isValidObjectId(id)) {
      return respondError(res, 400, ERROR_CODES.VALIDATION_ERROR, 'Identificador de usuario inválido');
    }

    const user = await User.findById(id);
    if (!user) {
      return respondError(res, 404, ERROR_CODES.NOT_FOUND, 'Usuario no encontrado');
    }

    user.active = value.active;
    await user.save();

    await createEvent('user_status_changed', { userId: user._id, email: user.email, active: value.active }, {});

    return res.json({ success: true, data: { user: user.toJSON() } });
  } catch (err) {
    if (err && err.name === 'CastError') {
      return respondError(res, 400, ERROR_CODES.VALIDATION_ERROR, 'Identificador de usuario inválido');
    }
    return next(err);
  }
};

const updateUserProfile = async (req, res, next) => {
  try {
    const { error: validationError, value } = profileSchema.validate(req.body || {});
    if (validationError) {
      return respondError(res, 400, ERROR_CODES.VALIDATION_ERROR, validationError.details[0].message);
    }

    const id = req.params.id;
    if (!mongoose.isValidObjectId(id)) {
      return respondError(res, 400, ERROR_CODES.VALIDATION_ERROR, 'Identificador de usuario inválido');
    }

    const user = await User.findById(id);
    if (!user) {
      return respondError(res, 404, ERROR_CODES.NOT_FOUND, 'Usuario no encontrado');
    }

    const changed = {};
    for (const field of PROFILE_FIELDS) {
      if (value[field] === undefined) continue;
      const normalized = normalizeProfileValue(value[field]);
      if (normalizeProfileValue(user[field]) !== normalized) {
        changed[field] = normalized;
      }
      user[field] = normalized;
    }
    await user.save();

    await createEvent('user_profile_updated', { userId: user._id, changed }, {});

    return res.json({ success: true, data: { user: user.toJSON() } });
  } catch (err) {
    if (err && err.name === 'CastError') {
      return respondError(res, 400, ERROR_CODES.VALIDATION_ERROR, 'Identificador de usuario inválido');
    }
    return next(err);
  }
};

const resetPassword = async (req, res, next) => {
  try {
    const id = req.params.id;
    if (!mongoose.isValidObjectId(id)) {
      return respondError(res, 400, ERROR_CODES.VALIDATION_ERROR, 'Identificador de usuario inválido');
    }

    const user = await User.findById(id);
    if (!user) {
      return respondError(res, 404, ERROR_CODES.NOT_FOUND, 'Usuario no encontrado');
    }

    const provisionalPassword = generateProvisionalPassword();
    user.passwordHash = await hashPassword(provisionalPassword);
    user.mustChangePassword = true;
    await user.save();

    await createEvent('user_password_reset', { userId: user._id, email: user.email }, {});

    return res.json({ success: true, data: { user: user.toJSON(), provisionalPassword } });
  } catch (err) {
    if (err && err.name === 'CastError') {
      return respondError(res, 400, ERROR_CODES.VALIDATION_ERROR, 'Identificador de usuario inválido');
    }
    return next(err);
  }
};

const importUsers = async (req, res, next) => {
  try {
    const { error: validationError, value } = importSchema.validate(req.body || {});
    if (validationError) {
      return respondError(res, 400, ERROR_CODES.VALIDATION_ERROR, validationError.details[0].message);
    }

    const result = await runBulkImport(value.users);
    return res.json({ success: true, data: result });
  } catch (err) {
    return next(err);
  }
};

module.exports = { createUser, listUsers, updateUserStatus, updateUserProfile, resetPassword, importUsers };
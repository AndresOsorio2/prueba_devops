const Joi = require('joi');
const User = require('../models/User');
const { PERMISSIONS } = require('../models/permissions');
const { validatePasswordPolicy, hashPassword, PasswordPolicyError } = require('./passwordService');
const { isEmailAllowed } = require('./domainService');
const { createEvent } = require('./eventSourcingService');
const logger = require('../logger/seqLogger');
const { normalizeProfileValue, profileJoiSchema } = require('../utils/userDisplay');

const importUserRowSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required(),
  permissions: Joi.array().items(Joi.string().valid(...PERMISSIONS)).default([])
}).concat(profileJoiSchema()).unknown(false);

function normalizeEmail(email) {
  return String(email).trim().toLowerCase();
}

async function importUsers(rows, UserModel = User) {
  if (!rows || rows.length === 0) {
    return { created: 0, rejected: [] };
  }

  const normalized = rows.map((row) => normalizeEmail(row && row.email));
  const existing = await UserModel.find({ email: { $in: [...new Set(normalized)] } });
  const existingEmails = new Set(existing.map((user) => normalizeEmail(user.email)));

  let createdCount = 0;
  const rejected = [];
  const batchSeen = new Set();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const email = normalized[i];

    const { error: rowError, value } = importUserRowSchema.validate(row);
    if (rowError) {
      rejected.push({ row: i, reason: 'VALIDATION_ERROR' });
      continue;
    }

    if (batchSeen.has(email)) {
      rejected.push({ row: i, reason: 'EMAIL_ALREADY_EXISTS' });
      continue;
    }
    batchSeen.add(email);

    if (existingEmails.has(email)) {
      rejected.push({ row: i, reason: 'EMAIL_ALREADY_EXISTS' });
      continue;
    }

    if (!isEmailAllowed(email)) {
      rejected.push({ row: i, reason: 'EMAIL_DOMAIN_NOT_ALLOWED' });
      continue;
    }

    try {
      validatePasswordPolicy(value.password);
    } catch (err) {
      if (err instanceof PasswordPolicyError) {
        rejected.push({ row: i, reason: 'VALIDATION_ERROR' });
        continue;
      }
      throw err;
    }

    try {
      const passwordHash = await hashPassword(value.password);
      const created = await UserModel.create({
        email,
        passwordHash,
        permissions: value.permissions,
        active: true,
        mustChangePassword: true,
        firstName: normalizeProfileValue(value.firstName),
        lastName: normalizeProfileValue(value.lastName),
        jobTitle: normalizeProfileValue(value.jobTitle)
      });
      createdCount += 1;
      await createEvent('user_created', { userId: created && created._id, email }, {}).catch((err) => {
        logger.error('🔴 Error creating user_created event', { error: err.message });
      });
    } catch (err) {
      if (err && err.code === 11000) {
        rejected.push({ row: i, reason: 'EMAIL_ALREADY_EXISTS' });
        continue;
      }
      throw err;
    }
  }

  return { created: createdCount, rejected };
}

module.exports = { importUsers, importUserRowSchema, normalizeEmail };
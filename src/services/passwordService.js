const crypto = require('crypto');
const bcrypt = require('bcrypt');

const BCRYPT_ROUNDS = 10;

const PASSWORD_POLICY = {
  MIN_LENGTH: 8,
  REQUIRE_UPPERCASE: true,
  REQUIRE_LOWERCASE: true,
  REQUIRE_NUMBER: true
};

class PasswordPolicyError extends Error {
  constructor(message, missing = []) {
    super(message);
    this.name = 'PasswordPolicyError';
    this.missing = missing;
  }
}

function validatePasswordPolicy(password) {
  if (typeof password !== 'string') {
    throw new PasswordPolicyError('La contraseña debe ser un texto', ['string']);
  }

  const missing = [];
  if (password.length < PASSWORD_POLICY.MIN_LENGTH) {
    missing.push('length');
  }
  if (PASSWORD_POLICY.REQUIRE_UPPERCASE && !/[A-Z]/.test(password)) {
    missing.push('uppercase');
  }
  if (PASSWORD_POLICY.REQUIRE_LOWERCASE && !/[a-z]/.test(password)) {
    missing.push('lowercase');
  }
  if (PASSWORD_POLICY.REQUIRE_NUMBER && !/[0-9]/.test(password)) {
    missing.push('number');
  }

  if (missing.length > 0) {
    const requirements = [];
    if (missing.includes('length')) requirements.push(`al menos ${PASSWORD_POLICY.MIN_LENGTH} caracteres`);
    if (missing.includes('uppercase')) requirements.push('una mayúscula');
    if (missing.includes('lowercase')) requirements.push('una minúscula');
    if (missing.includes('number')) requirements.push('un número');
    throw new PasswordPolicyError(`La contraseña debe incluir ${requirements.join(', ')}`, missing);
  }
}

async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

async function verifyPassword(password, hash) {
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
}

function generateProvisionalPassword() {
  let provisional = crypto.randomBytes(12).toString('base64url');
  if (!/[A-Z]/.test(provisional)) provisional = `A${provisional}`;
  if (!/[a-z]/.test(provisional)) provisional = `a${provisional}`;
  if (!/[0-9]/.test(provisional)) provisional = `${provisional}1`;
  return provisional;
}

module.exports = {
  hashPassword,
  verifyPassword,
  validatePasswordPolicy,
  generateProvisionalPassword,
  PasswordPolicyError,
  PASSWORD_POLICY,
  BCRYPT_ROUNDS
};
const jwt = require('jsonwebtoken');
const config = require('../config');

const COOKIE_NAME = 'dm_token';
const DEFAULT_TOKEN_EXPIRES_IN = '8h';

function resolveExpiresIn() {
  return config.tokenExpiresIn;
}

function resolveMaxAgeMs(expiresIn) {
  return config.resolveMaxAgeMs(expiresIn);
}

async function signToken(userId) {
  return jwt.sign({ sub: String(userId) }, config.jwtSecret, { expiresIn: resolveExpiresIn() });
}

async function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret);
}

function buildCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.nodeEnv === 'production',
    path: '/',
    maxAge: resolveMaxAgeMs(resolveExpiresIn())
  };
}

module.exports = {
  COOKIE_NAME,
  DEFAULT_TOKEN_EXPIRES_IN,
  signToken,
  verifyToken,
  buildCookieOptions
};
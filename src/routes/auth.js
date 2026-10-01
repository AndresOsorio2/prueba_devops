const express = require('express');
const rateLimit = require('express-rate-limit');
const authenticate = require('../middleware/authenticate');
const { login, changePassword, getMe, logout } = require('../controllers/authController');
const { respondError } = require('../utils/respondError');

const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => respondError(res, 429, 'RATE_LIMITED', 'Demasiados intentos de login. Intente de nuevo en unos minutos.')
});

const router = express.Router();

router.post('/login', loginRateLimiter, (req, res, next) =>
  login(req, res, next, { resetLoginAttempts: () => loginRateLimiter.resetKey(req.rateLimit.key) })
);
router.use(authenticate);
router.post('/change-password', changePassword);
router.get('/me', getMe);
router.post('/logout', logout);

module.exports = router;
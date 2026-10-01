const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const config = require('./config');
const authenticate = require('./middleware/authenticate');
const logger = require('./logger/seqLogger');
const { ERROR_CODES, MESSAGES } = require('./utils/messages');
const { respondError } = require('./utils/respondError');

// D-101: el origen permitido se lee en cada request, no al cargar el modulo, para que
// los tests que reconfiguran CORS_ORIGIN sigan mandando.
function corsOrigin(origin, callback) {
  const allowedOrigin = config.corsOrigin;
  if (!origin || origin === allowedOrigin) {
    return callback(null, origin === allowedOrigin);
  }
  return callback(null, false);
}

function createApp() {
  const app = express();

  app.use(cookieParser());
  app.use(cors({ origin: corsOrigin, credentials: true }));
  app.use(express.json());

  // Público
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date() });
  });

  // Auth: /login público (con rate limiting); /me y /logout se autoprotegen
  app.use('/api/auth', require('./routes/auth'));

  // Autenticación global: protege todos los routers siguientes
  app.use(authenticate);

  app.use('/api/users', require('./routes/users'));
  app.use('/api/projects', require('./routes/projects'));
  app.use('/api/projects', require('./routes/documents'));
  app.use('/api/documents', require('./routes/documents'));
  app.use('/api/documents', require('./routes/rules'));
  app.use('/api/rules', require('./routes/rules'));
  app.use('/api/rules', require('./routes/evidences'));
  app.use('/api/evidences', require('./routes/evidences'));
  app.use('/api/projects', require('./routes/events'));
  app.use('/api/dashboard', require('./routes/dashboard'));
  app.use('/api/templates', require('./routes/templates'));

  // Error handler
  app.use((err, req, res, next) => {
    logger.error('🔴 Unhandled error', { error: err.message, stack: err.stack });
    respondError(res, 500, ERROR_CODES.INTERNAL_ERROR, MESSAGES.INTERNAL_SERVER_ERROR);
  });

  return app;
}

module.exports = { createApp };
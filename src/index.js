require('dotenv').config();
// D-002: dotenv se carga antes de importar config, para que los getters lean un entorno completo.
const config = require('./config');
const mongoose = require('mongoose');
const logger = require('./logger/seqLogger');
const { createApp } = require('./app');

// D-103: este es el unico punto del backend que exige las variables obligatorias.
config.validate();

const app = createApp();
const PORT = config.port;

// MongoDB connection
mongoose.connect(config.mongoUri)
  .then(() => {
    logger.info('🔵 MongoDB connected successfully');
    console.log('MongoDB connected');
  })
  .catch(err => {
    logger.error('🔴 MongoDB connection error', { error: err.message });
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

// Start server
app.listen(PORT, () => {
  logger.info(`🔵 Server running on port ${PORT}`);
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;
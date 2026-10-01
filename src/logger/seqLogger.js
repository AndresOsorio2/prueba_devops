const winston = require('winston');
const config = require('../config');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.errors({ stack: true }),
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

// Add SEQ transport async (ESM module)
if (config.seq.serverUrl) {
  import('@datalust/winston-seq').then(({ SeqTransport }) => {
    logger.add(new SeqTransport({
      serverUrl: config.seq.serverUrl,
      apiKey: config.seq.apiKey,
      onError: (e) => { console.error('SEQ Transport error:', e); },
      handleExceptions: true,
      handleRejections: true
    }));
    console.log('SEQ transport added');
  }).catch(err => {
    console.warn('SEQ transport not available:', err.message);
  });
}

module.exports = logger;

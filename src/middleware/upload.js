const fs = require('fs');
const path = require('path');
const multer = require('multer');
const config = require('../config');

const ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // D-101: se resuelve por request, no al cargar el modulo.
    const ruleDir = path.join(config.uploadDir, String(req.params.ruleId));
    fs.mkdirSync(ruleDir, { recursive: true });
    cb(null, ruleDir);
  },
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    cb(null, `${Date.now()}-${safeName}`);
  }
});

const fileFilter = (req, file, cb) => {
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    return cb(new Error('INVALID_FILE_TYPE'));
  }
  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE }
});

module.exports = { upload, UPLOAD_DIR: config.uploadDir, ALLOWED_MIME_TYPES, MAX_FILE_SIZE };

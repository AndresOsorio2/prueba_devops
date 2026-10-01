const mongoose = require('mongoose');

const evidenceSchema = new mongoose.Schema({
  ruleId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Rule',
    required: true
  },
  type: {
    type: String,
    enum: ['file', 'text', 'url'],
    required: true
  },
  value: {
    type: String,
    required: true
  },
  originalName: {
    type: String
  },
  mimeType: {
    type: String
  },
  size: {
    type: Number
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Evidence', evidenceSchema);

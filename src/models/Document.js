const mongoose = require('mongoose');

const documentSchema = new mongoose.Schema({
  projectId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
    required: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    default: ''
  },
  deadline: {
    type: Date,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'in_progress', 'done'],
    default: 'pending'
  },
  order: {
    type: Number,
    default: 0
  },
  reportMarkdown: {
    type: String,
    default: null
  },
  reportEditedAt: {
    type: Date,
    default: null
  },
  responsible: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Document', documentSchema);

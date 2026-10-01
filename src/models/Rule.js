const mongoose = require('mongoose');
const { RULE_TYPES } = require('./ruleTypes');

const ruleSchema = new mongoose.Schema({
  documentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Document',
    required: true
  },
  parentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Rule',
    default: null
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
  type: {
    type: String,
    enum: RULE_TYPES,
    required: true
  },
  required: {
    type: Boolean,
    default: true
  },
  deadline: {
    type: Date
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
  selectOptions: [{
    type: String
  }],
  markdownContent: {
    type: String,
    default: ''
  },
  notify: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

ruleSchema.index({ documentId: 1, parentId: 1 });

module.exports = mongoose.model('Rule', ruleSchema);

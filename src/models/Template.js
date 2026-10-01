const mongoose = require('mongoose');
const { RULE_TYPES } = require('./ruleTypes');

const templateItemSchema = new mongoose.Schema({
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
}, { _id: true });

templateItemSchema.add({ children: { type: [templateItemSchema], default: [] } });

const templateSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  description: {
    type: String,
    default: ''
  },
  items: {
    type: [templateItemSchema],
    default: []
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Template', templateSchema);
module.exports.templateItemSchema = templateItemSchema;
module.exports.templateSchema = templateSchema;
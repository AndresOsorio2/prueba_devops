const mongoose = require('mongoose');

const eventSchema = new mongoose.Schema({
  projectId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project'
  },
  documentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Document'
  },
  ruleId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Rule'
  },
  eventType: {
    type: String,
    enum: [
      'project_created', 'project_updated', 'project_deleted', 'project_status_changed',
      'document_created', 'document_updated', 'document_deleted', 'document_status_changed',
      'document_responsible_changed',
      'rule_created', 'rule_updated', 'rule_deleted', 'rule_status_changed',
      'evidence_added', 'evidence_deleted',
      'report_generated', 'report_edited', 'ai_report_generated',
      'user_login_succeeded', 'user_login_failed', 'user_created', 'user_status_changed',
      'user_password_changed', 'user_password_reset', 'user_profile_updated',
      'project_participant_added', 'project_participant_removed'
    ],
    required: true
  },
  payload: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
});

eventSchema.index({ projectId: 1, timestamp: -1 });
eventSchema.index({ documentId: 1 });
eventSchema.index({ ruleId: 1 });

module.exports = mongoose.model('Event', eventSchema);

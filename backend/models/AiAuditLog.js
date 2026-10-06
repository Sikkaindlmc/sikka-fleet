const mongoose = require('mongoose');

const aiAuditLogSchema = new mongoose.Schema(
  {
    actionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
    user: {
      type: String,
      required: true,
      default: 'Sikka AI System',
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    userRole: {
      type: String,
      default: 'System',
    },
    actionType: {
      type: String,
      required: true,
      index: true,
      // 'GPS_SYNC', 'DRIVER_SYNC', 'QUERY', 'ERROR_DETECTED', 'AUTO_REPAIR',
      // 'APPROVAL_REQUESTED', 'APPROVAL_PROCESSED', 'SENSITIVE_BLOCKED', 'SENSITIVE_EXECUTED'
    },
    vehicle: {
      type: String,
      default: '—',
      index: true,
    },
    driver: {
      type: String,
      default: '—',
      index: true,
    },
    plant: {
      type: String,
      default: '—',
      index: true,
    },
    oldValue: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    newValue: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    reason: {
      type: String,
      default: '',
    },
    aiVerification: {
      type: String,
      default: 'Verified by Sikka AI Policy Engine',
    },
    approvalRequired: {
      type: Boolean,
      default: false,
    },
    approvedBy: {
      type: String,
      default: '—',
    },
    approvalDateTime: {
      type: Date,
      default: null,
    },
    result: {
      type: String,
      enum: ['Success', 'Failed', 'Blocked', 'Pending Approval', 'Repaired', 'Rejected'],
      default: 'Success',
      index: true,
    },
    errorDetails: {
      type: String,
      default: '',
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  {
    collection: 'aiAuditLogs',
    timestamps: true,
  }
);

aiAuditLogSchema.index({ timestamp: -1 });
aiAuditLogSchema.index({ actionType: 1, timestamp: -1 });

module.exports = mongoose.model('AiAuditLog', aiAuditLogSchema);

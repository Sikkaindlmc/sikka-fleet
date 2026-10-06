const mongoose = require('mongoose');

const aiApprovalRequestSchema = new mongoose.Schema(
  {
    requestId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    requestedByName: {
      type: String,
      required: true,
      trim: true,
    },
    requestedByUsername: {
      type: String,
      default: '',
    },
    actionType: {
      type: String,
      required: true,
      enum: [
        'PLANT_CONFIG_CHANGE',
        'RECORD_DELETION',
        'USER_PERMISSION_CHANGE',
        'DATABASE_MODIFICATION',
        'GPS_CONFIG_CHANGE',
        'VEHICLE_DELETE',
        'DRIVER_DELETE',
        'HISTORICAL_RECORD_MODIFY',
        'BUSINESS_RULE_CHANGE',
        'OTHER_SENSITIVE',
      ],
      index: true,
    },
    actionTitle: {
      type: String,
      required: true,
    },
    actionDescription: {
      type: String,
      required: true,
    },
    reason: {
      type: String,
      default: 'Requested via Sikka AI Assistant',
    },
    affectedRecordType: {
      type: String,
      required: true, // 'Plant', 'Vehicle', 'Driver', 'PlantEntry', 'User', 'GpsSetting', etc.
    },
    affectedRecordId: {
      type: String,
      default: '',
    },
    affectedRecordLabel: {
      type: String,
      default: '', // e.g. "Tea Plant", "UP14GT0300"
    },
    currentValue: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    requestedNewValue: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    aiVerificationResult: {
      type: String,
      default: 'Verified: Sensitive system modification requiring Administrator Authorization.',
    },
    aiRiskLevel: {
      type: String,
      enum: ['Low', 'Medium', 'High', 'Critical'],
      default: 'High',
    },
    status: {
      type: String,
      enum: ['Pending', 'Approved', 'Rejected', 'Executed', 'Failed'],
      default: 'Pending',
      index: true,
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    approvedByName: {
      type: String,
      default: null,
    },
    approvedAt: {
      type: Date,
      default: null,
    },
    rejectedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    rejectedByName: {
      type: String,
      default: null,
    },
    rejectedAt: {
      type: Date,
      default: null,
    },
    rejectionReason: {
      type: String,
      default: null,
    },
    executionResult: {
      type: String,
      default: null,
    },
    executedAt: {
      type: Date,
      default: null,
    },
  },
  {
    collection: 'aiApprovalRequests',
    timestamps: true,
  }
);

aiApprovalRequestSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('AiApprovalRequest', aiApprovalRequestSchema);

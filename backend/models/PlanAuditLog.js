const mongoose = require('mongoose');

const planAuditLogSchema = new mongoose.Schema(
  {
    activityType: {
      type: String,
      enum: ['PLAN_CREATED', 'PLAN_UPDATED', 'PLAN_DELETED'],
      default: 'PLAN_DELETED',
      required: true,
      index: true,
    },
    planId: {
      type: String,
      default: null,
      index: true,
    },
    vehicleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vehicle',
      required: true,
      index: true,
    },
    vehicleNumber: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    plantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Plant',
      default: null,
      index: true,
    },
    plantName: {
      type: String,
      default: 'Plant',
    },
    location: {
      type: String,
      default: '',
    },
    planType: {
      type: String,
      enum: ['Add Plan', 'Next Trip Plan'],
      default: 'Add Plan',
    },
    planText: {
      type: String,
      required: true,
    },
    planAuthorName: {
      type: String,
      default: 'Unknown',
    },
    planAuthorUsername: {
      type: String,
      default: '',
    },
    planCreatedAt: {
      type: Date,
      default: null,
    },
    deletedByName: {
      type: String,
      default: null,
    },
    deletedByUsername: {
      type: String,
      default: null,
    },
    deletedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    deletedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    collection: 'plan_audit_logs',
    timestamps: true,
  }
);

// Compound index for quick vehicle audit history queries
planAuditLogSchema.index({ vehicleId: 1, deletedAt: -1 });
planAuditLogSchema.index({ activityType: 1, deletedAt: -1 });

module.exports = mongoose.model('PlanAuditLog', planAuditLogSchema);

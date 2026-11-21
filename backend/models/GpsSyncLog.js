const mongoose = require('mongoose');

const gpsSyncLogSchema = new mongoose.Schema(
  {
    syncId: {
      type: String,
      required: true,
      index: true,
    },
    startedAt: {
      type: Date,
      required: true,
      index: true,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: ['RUNNING', 'SUCCESS', 'FAILED', 'PARTIAL'],
      default: 'RUNNING',
      index: true,
    },
    source: {
      type: String,
      enum: ['AUTO', 'STARTUP', 'RETRY', 'GPS-AUTO'],
      default: 'GPS-AUTO',
      index: true,
    },
    syncType: {
      type: String,
      enum: ['AUTO', 'MANUAL'],
      default: undefined,
      index: true,
    },
    triggerType: {
      type: String,
      default: 'GPS_AUTO_SYNC_30MIN',
    },
    slotKey: {
      type: String,
      default: undefined,
    },
    vehiclesFound: {
      type: Number,
      default: 0,
    },
    vehiclesProcessed: {
      type: Number,
      default: 0,
    },
    vehiclesUpdated: {
      type: Number,
      default: 0,
    },
    vehiclesFailed: {
      type: Number,
      default: 0,
    },
    plantEntriesRecorded: {
      type: Number,
      default: 0,
    },
    apiResponseStatus: {
      type: String,
      default: '',
    },
    errorMessage: {
      type: String,
      default: '',
    },
    executionTimeMs: {
      type: Number,
      default: 0,
    },
    lastEvaluatedTimestamp: {
      type: Date,
      default: null,
    },
    nextScheduledSyncAt: {
      type: Date,
      default: null,
    },
    provider: {
      type: String,
      default: 'WheelsEye GPS',
    },
    archived: { type: Boolean, default: false, index: true },
    driversChecked: {
      type: Number,
      default: 0,
    },
    vehiclesChecked: {
      type: Number,
      default: 0,
    },
    eligibleMatches: {
      type: Number,
      default: 0,
    },
    autoAssignmentsCompleted: {
      type: Number,
      default: 0,
    },
    vehiclesWithMultipleDrivers: {
      type: Number,
      default: 0,
    },
    comparisonsSkipped: {
      type: Number,
      default: 0,
    },
    skippedReasons: {
      type: [String],
      default: [],
    },
    assignmentConflicts: {
      type: [String],
      default: [],
    },
  },
  {
    collection: 'gps_sync_logs',
    timestamps: true,
  }
);

gpsSyncLogSchema.index({ startedAt: -1 });
gpsSyncLogSchema.index({ source: 1, startedAt: -1 });
gpsSyncLogSchema.index({ slotKey: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('GpsSyncLog', gpsSyncLogSchema);

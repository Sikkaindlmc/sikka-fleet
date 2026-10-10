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
      enum: ['RUNNING', 'SUCCESS', 'FAILED'],
      default: 'RUNNING',
      index: true,
    },
    source: {
      type: String,
      enum: ['AUTO', 'MANUAL', 'STARTUP', 'RETRY'],
      default: 'AUTO',
      index: true,
    },
    triggerType: {
      type: String,
      default: 'GPS_AUTO_SYNC_30MIN',
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
  },
  {
    collection: 'gps_sync_logs',
    timestamps: true,
  }
);

gpsSyncLogSchema.index({ startedAt: -1 });
gpsSyncLogSchema.index({ source: 1, startedAt: -1 });

module.exports = mongoose.model('GpsSyncLog', gpsSyncLogSchema);

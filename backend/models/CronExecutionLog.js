const mongoose = require('mongoose');

const cronExecutionLogSchema = new mongoose.Schema(
  {
    jobName: {
      type: String,
      default: 'Wheelseye GPS 30-Min Auto Sync',
    },
    triggerType: {
      type: String,
      default: 'CRON_WORKER_IST',
    },
    status: {
      type: String,
      enum: ['RUNNING', 'SUCCESS', 'FAILED'],
      default: 'RUNNING',
    },
    startedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    durationMs: {
      type: Number,
      default: 0,
    },
    totalVehiclesFetched: {
      type: Number,
      default: 0,
    },
    vehiclesProcessed: {
      type: Number,
      default: 0,
    },
    plantEntriesCount: {
      type: Number,
      default: 0,
    },
    lastEvaluatedTimestamp: {
      type: Date,
      default: null,
    },
    errorDetails: {
      type: String,
      default: '',
    },
    provider: {
      type: String,
      default: 'WheelsEye GPS',
    },
  },
  {
    collection: 'cron_execution_logs',
    timestamps: true,
  }
);

cronExecutionLogSchema.index({ startedAt: -1 });

module.exports = mongoose.model('CronExecutionLog', cronExecutionLogSchema);

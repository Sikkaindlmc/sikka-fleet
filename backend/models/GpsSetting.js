const mongoose = require('mongoose');

const gpsSettingSchema = new mongoose.Schema(
  {
    provider: {
      type: String,
      required: [true, 'GPS provider name is required'],
      trim: true,
      default: 'WheelsEye GPS',
    },
    archived: { type: Boolean, default: false, index: true },
    apiUrl: {
      type: String,
      trim: true,
      default: '',
    },
    encryptedApiKey: {
      type: String,
      default: '',
    },
    status: {
      type: String,
      enum: ['Active', 'Inactive'],
      default: 'Active',
    },
    connectionStatus: {
      type: String,
      enum: ['Connected', 'Connection Failed', 'Pending', 'AUTH_FAILED'],
      default: 'Connected',
    },
    lastSync: {
      type: Date,
      default: null,
    },
    last_evaluated_timestamp: {
      type: Date,
      default: null,
    },
    last_sync_status: {
      type: String,
      enum: ['SUCCESS', 'FAILED', 'RUNNING', 'IDLE'],
      default: 'IDLE',
    },
    next_scheduled_sync_at: {
      type: Date,
      default: null,
    },
    last_sync_source: {
      type: String,
      default: 'AUTO',
    },
    vehicles_processed: {
      type: Number,
      default: 0,
    },
    vehicles_updated: {
      type: Number,
      default: 0,
    },
    vehicles_failed: {
      type: Number,
      default: 0,
    },
    lastError: {
      type: String,
      default: '',
    },
    lastSuccessAt: {
      type: Date,
      default: null,
    },
    lastErrorAt: {
      type: Date,
      default: null,
    },
    lastErrorCode: {
      type: String,
      default: '',
    },
    lastCredentialSource: {
      type: String,
      default: '',
    },
    consecutiveFailures: {
      type: Number,
      default: 0,
    },
    pollIntervalSeconds: {
      type: Number,
      default: 1800,
    },
    vehicleIcon: {
      type: String,
      default: '',
    },
    vehicleIconUpdatedAt: {
      type: Date,
      default: null,
    },
  },
  {
    collection: 'gpsSettings',
    timestamps: true,
  }
);

module.exports = mongoose.model('GpsSetting', gpsSettingSchema);

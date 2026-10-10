const mongoose = require('mongoose');

const gpsSettingSchema = new mongoose.Schema(
  {
    provider: {
      type: String,
      required: [true, 'GPS provider name is required'],
      trim: true,
      default: 'WheelsEye GPS',
    },
    apiUrl: {
      type: String,
      trim: true,
      default: 'https://api.wheelseye.com/currentLoc?accessToken=53afc208-0981-48c7-b134-d85d2f33dc0c',
    },
    encryptedApiKey: {
      type: String,
      default: '53afc208-0981-48c7-b134-d85d2f33dc0c',
    },
    apiSecret: {
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
      enum: ['Connected', 'Connection Failed', 'Pending'],
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

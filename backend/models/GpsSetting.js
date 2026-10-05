const mongoose = require('mongoose');

const gpsSettingSchema = new mongoose.Schema(
  {
    provider: {
      type: String,
      required: [true, 'GPS provider name is required'],
      trim: true,
      default: 'Fleet Telematics GPS Provider',
    },
    apiUrl: {
      type: String,
      trim: true,
      default: 'https://api.gps-provider.local/v1/vehicles',
    },
    encryptedApiKey: {
      type: String,
      default: 'sikka_live_gps_key_9948271',
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
    lastError: {
      type: String,
      default: '',
    },
    pollIntervalSeconds: {
      type: Number,
      default: 15,
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

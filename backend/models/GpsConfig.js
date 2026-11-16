const mongoose = require('mongoose');

const gpsConfigSchema = new mongoose.Schema(
  {
    provider: {
      type: String,
      required: [true, 'GPS provider name is required'],
      trim: true,
    },
    apiUrl: {
      type: String,
      trim: true,
      default: '',
    },
    encryptedApiKey: {
      type: String,
      default: '',
    },
    encryptedApiSecret: {
      type: String,
      default: '',
    },
    status: {
      type: String,
      enum: ['Active', 'Inactive'],
      default: 'Inactive',
    },
    pollIntervalSeconds: {
      type: Number,
      default: 1800,
      min: 1800,
      max: 1800,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('GpsConfig', gpsConfigSchema);

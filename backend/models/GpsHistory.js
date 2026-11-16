const mongoose = require('mongoose');

const gpsHistorySchema = new mongoose.Schema(
  {
    vehicleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vehicle',
      required: true,
      index: true,
    },
    vehicleNumber: { type: String, required: true, trim: true },
    vehicleNumberNormalized: { type: String, required: true, trim: true },
    provider: { type: String, required: true, trim: true },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    speed: { type: mongoose.Schema.Types.Mixed, default: null },
    ignition: { type: mongoose.Schema.Types.Mixed, default: null },
    gpsTimestamp: { type: Date, required: true },
    syncTime: { type: Date, required: true },
    rawTelemetry: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { collection: 'gpsHistory', timestamps: true }
);

gpsHistorySchema.index(
  { vehicleNumberNormalized: 1, provider: 1, gpsTimestamp: 1 },
  { unique: true, name: 'unique_vehicle_provider_gps_timestamp' }
);
gpsHistorySchema.index({ vehicleId: 1, gpsTimestamp: -1 });

module.exports = mongoose.model('GpsHistory', gpsHistorySchema);

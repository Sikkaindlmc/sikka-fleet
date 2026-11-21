const mongoose = require('mongoose');

const gpsHistorySchema = new mongoose.Schema(
  {
    vehicleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vehicle',
      index: true,
    },
    vehicleNumber: { type: String, required: true, trim: true },
    vehicleNumberNormalized: { type: String, required: true, trim: true },
    provider: { type: String, required: true, trim: true },
    archived: { type: Boolean, default: false, index: true },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    address: { type: String, default: '' },
    speed: { type: mongoose.Schema.Types.Mixed, default: null },
    ignition: { type: mongoose.Schema.Types.Mixed, default: null },
    gpsTimestamp: { type: Date, required: true },
    syncTime: { type: Date, required: true },
    syncId: { type: String, default: '' },
    syncType: { type: String, enum: ['AUTO', 'MANUAL'], default: undefined },
    statusEligible: { type: Boolean, default: undefined },
    providerTransitionTimestamp: { type: Date, default: null },
    geofence_status: { type: String, enum: ['INSIDE', 'OUTSIDE', 'UNKNOWN'], default: 'UNKNOWN' },
    candidateGeofenceStatus: { type: String, enum: ['INSIDE', 'OUTSIDE', 'UNKNOWN'], default: null },
    candidatePlantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plant', default: null },
    plantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plant', default: null },
    plantName: { type: String, default: '' },
    distanceMeter: { type: Number, default: null },
    plantRadiusMeters: { type: Number, default: null },
    configuredPlantRadii: {
      type: [{
        plantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plant', default: null },
        plantName: { type: String, required: true },
        radiusMeters: { type: Number, required: true },
      }],
      default: [],
    },
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

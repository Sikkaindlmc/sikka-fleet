const mongoose = require('mongoose');

const vehicleCurrentStatusSchema = new mongoose.Schema(
  {
    vehicleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vehicle',
      required: true,
      index: true,
    },
    vehicleNumber: {
      type: String,
      default: '',
      index: true,
    },
    currentPlantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Plant',
      default: null,
      index: true,
    },
    current_plant: {
      type: String,
      default: null,
    },
    current_geofence: {
      type: String,
      enum: ['INSIDE', 'OUTSIDE', 'UNKNOWN'],
      default: 'OUTSIDE',
      index: true,
    },
    status: {
      type: String,
      enum: ['Inside', 'Outside'],
      default: 'Outside',
      index: true,
    },
    latitude: {
      type: Number,
      default: null,
    },
    longitude: {
      type: Number,
      default: null,
    },
    distanceMeter: {
      type: Number,
      default: null,
    },
    plantRadiusMeters: {
      type: Number,
      default: null,
    },
    configuredPlantRadii: {
      type: [{
        plantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plant', default: null },
        plantName: { type: String, required: true },
        radiusMeters: { type: Number, required: true },
      }],
      default: [],
    },
    latest_gps_timestamp: {
      type: Date,
      default: null,
      index: true,
    },
    last_successful_sync_at: {
      type: Date,
      default: null,
    },
    gps_status: {
      type: String,
      enum: ['LIVE', 'RECENT', 'GPS STALE', 'GPS SYNC FAILED', 'GPS DATA UNAVAILABLE'],
      default: 'LIVE',
      index: true,
    },
    last_sync_source: {
      type: String,
      enum: ['AUTO', 'MANUAL', 'STARTUP', 'RETRY', 'GPS-AUTO'],
      default: 'GPS-AUTO',
    },
    stayHours: {
      type: String,
      default: '00:00',
    },
    speed: {
      type: Number,
      default: null,
    },
    speedRaw: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    ignition: {
      type: Boolean,
      default: null,
    },
    ignitionRaw: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    movementStatus: {
      type: String,
      enum: ['Moving', 'Stopped', null],
      default: null,
    },
    provider: {
      type: String,
      default: null,
    },
    archived: {
      type: Boolean,
      default: false,
      index: true,
    },
    rawTelemetry: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    address: {
      type: String,
      default: '',
    },
    lastEntryDateTime: {
      type: Date,
      default: null,
    },
    lastEntryDetectedAt: {
      type: Date,
      default: null,
    },
    lastEntryGpsTimestamp: {
      type: Date,
      default: null,
    },
    lastExitPlantName: {
      type: String,
      default: null,
    },
    lastExitDateTime: {
      type: Date,
      default: null,
    },
    lastExitDetectedAt: {
      type: Date,
      default: null,
    },
    lastExitGpsTimestamp: {
      type: Date,
      default: null,
    },
    lastSyncId: {
      type: String,
      default: '',
    },
    lastSyncType: {
      type: String,
      enum: ['AUTO', 'MANUAL'],
      default: undefined,
    },
    lastUpdatedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    plans: [
      {
        planText: { type: String, required: true },
        authorName: { type: String, required: true },
        authorUsername: { type: String },
        planType: {
          type: String,
          enum: ['Add Plan', 'Next Trip Plan'],
          default: 'Add Plan',
        },
        createdAt: { type: Date, default: Date.now },
        expiresAt: { type: Date, default: null, index: true },
      },
    ],
    matchingDrivers: [
      {
        id: String,
        driverId: { type: mongoose.Schema.Types.ObjectId, ref: 'Driver' },
        driverName: String,
        dlNumber: String,
        mobileNumber: String,
        photo: { type: String, default: null },
        distanceMeters: Number,
        radiusFromVehicleMeter: Number,
        lastLocationAt: { type: Date, default: null },
      },
    ],
    matchingDriversCount: {
      type: Number,
      default: 0,
    },
    driverDistance: {
      type: Number,
      default: null,
    },
    assignmentType: {
      type: String,
      enum: ['MANUAL', 'AUTO_GPS', 'NONE'],
      default: 'NONE',
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

vehicleCurrentStatusSchema.virtual('latest_latitude').get(function () {
  return this.latitude;
});

vehicleCurrentStatusSchema.virtual('latest_longitude').get(function () {
  return this.longitude;
});

vehicleCurrentStatusSchema.index(
  { vehicleId: 1 },
  {
    unique: true,
    name: 'one_active_gps_status_per_vehicle',
    partialFilterExpression: { archived: false },
  }
);

module.exports = mongoose.model('VehicleCurrentStatus', vehicleCurrentStatusSchema);

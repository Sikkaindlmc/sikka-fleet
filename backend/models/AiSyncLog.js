const mongoose = require('mongoose');

const failureItemSchema = new mongoose.Schema({
  entityType: {
    type: String,
    enum: ['Vehicle', 'Driver'],
    required: true,
  },
  identifier: {
    type: String, // Vehicle Number or Driver Name/DL
    required: true,
  },
  lastGpsTime: {
    type: Date,
    default: null,
  },
  expectedSyncTime: {
    type: Date,
    default: null,
  },
  result: {
    type: String,
    default: 'GPS Sync Failed',
  },
  status: {
    type: String,
    default: 'Location Not Synced',
  },
  reason: {
    type: String,
    default: 'GPS API response unavailable',
  },
  retryAttempts: {
    type: Number,
    default: 0,
  },
  retrySuccess: {
    type: Boolean,
    default: false,
  },
  errorDetails: {
    type: String,
    default: '',
  },
  resolvedAt: {
    type: Date,
    default: null,
  },
});

const repairItemSchema = new mongoose.Schema({
  issue: {
    type: String,
    required: true,
  },
  repairAction: {
    type: String,
    required: true,
  },
  recheckResult: {
    type: String,
    required: true,
  },
  success: {
    type: Boolean,
    default: true,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
});

const vehicleRecordSchema = new mongoose.Schema({
  vehicleNumber: { type: String, required: true },
  latitude: { type: Number, required: true },
  longitude: { type: Number, required: true },
  location: { type: String, default: '' },
  gpsDateTime: { type: Date, default: Date.now },
  plant: { type: String, default: 'Outside' },
  distanceFromPlant: { type: Number, default: null },
  gpsStatus: { type: String, default: 'Synced' },
});

const driverRecordSchema = new mongoose.Schema({
  driverName: { type: String, required: true },
  driverMobile: { type: String, default: '' },
  latitude: { type: Number, default: null },
  longitude: { type: Number, default: null },
  location: { type: String, default: '' },
  dateTime: { type: Date, default: Date.now },
  assignedVehicle: { type: String, default: 'Unassigned' },
  plant: { type: String, default: 'Outside' },
  locationStatus: { type: String, default: 'Location Deducted' },
});

const aiSyncLogSchema = new mongoose.Schema(
  {
    syncId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    syncType: {
      type: String,
      enum: ['Auto 30-Min Sync', 'Manual User Sync', 'Permitted User Sync', 'Retry Sync', 'Safe Auto-Repair Sync'],
      default: 'Auto 30-Min Sync',
    },
    initiatedBy: {
      type: String,
      default: 'Sikka AI Scheduler',
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
    status: {
      type: String,
      enum: ['Success', 'Partial Failure', 'Failed'],
      default: 'Success',
      index: true,
    },
    vehiclesTotal: {
      type: Number,
      default: 0,
    },
    vehiclesSuccess: {
      type: Number,
      default: 0,
    },
    vehiclesFailed: {
      type: Number,
      default: 0,
    },
    driversTotal: {
      type: Number,
      default: 0,
    },
    driversSuccess: {
      type: Number,
      default: 0,
    },
    driversFailed: {
      type: Number,
      default: 0,
    },
    failures: [failureItemSchema],
    repairsPerformed: [repairItemSchema],
    vehicleRecords: [vehicleRecordSchema],
    driverRecords: [driverRecordSchema],
    connectionStatus: {
      type: String,
      default: 'Connected',
    },
    apiLatencyMs: {
      type: Number,
      default: 0,
    },
  },
  {
    collection: 'aiSyncLogs',
    timestamps: true,
  }
);

aiSyncLogSchema.index({ startedAt: -1 });

module.exports = mongoose.model('AiSyncLog', aiSyncLogSchema);

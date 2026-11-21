const mongoose = require('mongoose');

const vehicleSchema = new mongoose.Schema(
  {
    vehicleNumber: {
      type: String,
      required: [true, 'Vehicle number is required'],
      unique: true,
      trim: true,
      uppercase: true,
    },
    driverName: {
      type: String,
      trim: true,
      default: '',
    },
    mobile: {
      type: String,
      trim: true,
      default: '',
    },
    fleetType: {
      type: String,
      required: [true, 'Fleet type is required'],
      enum: ['Own Fleet', 'Hired', 'Rental'],
    },
    ownerName: {
      type: String,
      trim: true,
      default: '',
    },
    gpsDeviceId: {
      type: String,
      trim: true,
      default: '',
    },
    fleetxVehicleId: {
      type: String,
      trim: true,
      default: '',
    },

    // GPS Configuration (Requirement 2 & 8)
    gps_mode: {
      type: String,
      enum: ['AUTO', 'MANUAL'],
      default: 'AUTO',
    },
    gps_provider: {
      type: String,
      enum: ['WHEELSEYE', 'FLEETX', 'BOTH'],
      default: 'WHEELSEYE',
    },

    // Backward compatibility fields
    gpsProvider: {
      type: String,
      enum: ['wheelseye', 'fleetx', 'WHEELSEYE', 'FLEETX'],
      default: 'wheelseye',
      lowercase: true,
      trim: true,
    },
    gpsProviders: {
      type: [{
        type: String,
      }],
      default: ['WheelsEye GPS'],
    },

    // Realtime GPS Telematics Snapshot on Vehicle Record (Requirement 8)
    gps_latitude: {
      type: Number,
      default: null,
    },
    gps_longitude: {
      type: Number,
      default: null,
    },
    gps_speed: {
      type: Number,
      default: null,
    },
    gps_ignition_status: {
      type: String,
      default: null, // 'ON', 'OFF', 'N/A'
    },
    gps_location: {
      type: String,
      default: '',
    },
    gps_last_updated_at: {
      type: Date,
      default: null,
    },
    gps_sync_status: {
      type: String,
      enum: ['SUCCESS', 'FAILED', 'DATA_UNAVAILABLE', 'PENDING'],
      default: 'PENDING',
    },
    gps_error_message: {
      type: String,
      default: '',
    },

    status: {
      type: String,
      enum: ['Active', 'Inactive'],
      default: 'Active',
    },
    assignedDriverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Driver',
      default: null,
    },
    assignmentType: {
      type: String,
      enum: ['MANUAL', 'AUTO_GPS', 'NONE'],
      default: 'NONE',
    },
    assignedAt: {
      type: Date,
      default: null,
    },
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
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Vehicle', vehicleSchema);

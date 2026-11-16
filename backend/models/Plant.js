const mongoose = require('mongoose');

const plantSchema = new mongoose.Schema(
  {
    plantName: {
      type: String,
      required: [true, 'Plant name is required'],
      trim: true,
    },
    location: {
      type: String,
      required: [true, 'Location is required'],
      trim: true,
    },
    radiusMeters: {
      type: Number,
      required: [true, 'Radius in meters is required'],
      min: [1, 'Radius must be greater than 0 meters'],
    },
    radiusMeter: {
      type: Number,
    },
    latitude: {
      type: Number,
      required: [true, 'Latitude is required'],
      min: [-90, 'Latitude must be between -90 and 90'],
      max: [90, 'Latitude must be between -90 and 90'],
    },
    longitude: {
      type: Number,
      required: [true, 'Longitude is required'],
      min: [-180, 'Longitude must be between -180 and 180'],
      max: [180, 'Longitude must be between -180 and 180'],
    },
    status: {
      type: String,
      enum: ['Active', 'Inactive'],
      default: 'Active',
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

plantSchema.index({ plantName: 1, status: 1 });

plantSchema.pre('validate', function () {
  if (this.latitude === 0 && this.longitude === 0) {
    this.invalidate('latitude', 'Plant coordinates cannot be 0,0.');
  }
});

module.exports = mongoose.model('Plant', plantSchema);

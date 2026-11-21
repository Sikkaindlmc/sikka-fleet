const mongoose = require('mongoose');

const vehicleGeocodeCacheSchema = new mongoose.Schema(
  {
    vehicleKey: {
      type: String,
      required: true,
      unique: true,
    },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    address: { type: String, default: '' },
    geocodedAt: { type: Date, default: Date.now },
  },
  { collection: 'vehicle_geocode_cache', timestamps: true }
);

module.exports = mongoose.model('VehicleGeocodeCache', vehicleGeocodeCacheSchema);

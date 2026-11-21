const mongoose = require('mongoose');

const gpsGeocodeCacheSchema = new mongoose.Schema(
  {
    coordinateKey: { type: String, required: true, unique: true },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    address: { type: String, default: '' },
    source: { type: String, default: 'Nominatim' },
    geocodedAt: { type: Date, default: Date.now },
  },
  { collection: 'gps_geocode_cache', timestamps: true }
);

module.exports = mongoose.model('GpsGeocodeCache', gpsGeocodeCacheSchema);

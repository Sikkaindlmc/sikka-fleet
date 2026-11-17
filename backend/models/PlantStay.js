const mongoose = require('mongoose');

const plantStaySchema = new mongoose.Schema(
  {
    vehicleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle', required: true },
    vehicleNumber: { type: String, required: true },
    vehicleNumberNormalized: { type: String, required: true, index: true },
    plantName: { type: String, required: true },
    entryGpsTimestamp: { type: Date, required: true },
    exitGpsTimestamp: { type: Date, default: null },
    lastGpsTimestamp: { type: Date, required: true },
    isCurrent: { type: Boolean, default: false, index: true },
    archived: { type: Boolean, default: false, index: true },
  },
  { collection: 'plantStays', timestamps: true }
);

plantStaySchema.index(
  { vehicleNumberNormalized: 1, plantName: 1, entryGpsTimestamp: 1 },
  { unique: true, name: 'unique_plant_stay' }
);

module.exports = mongoose.model('PlantStay', plantStaySchema);

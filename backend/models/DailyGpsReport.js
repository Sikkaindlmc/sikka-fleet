const mongoose = require('mongoose');

const dailyGpsReportSchema = new mongoose.Schema(
  {
    vehicleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle', required: true },
    vehicleNumber: { type: String, required: true },
    vehicleNumberNormalized: { type: String, required: true },
    date: { type: String, required: true },
    dasnaMinutes: { type: Number, required: true },
    saltPlantMinutes: { type: Number, required: true },
    teaPlantMinutes: { type: Number, required: true },
    outsideMinutes: { type: Number, required: true },
    noGpsDataMinutes: { type: Number, required: true },
    totalMinutes: { type: Number, required: true },
    inProgress: { type: Boolean, default: false },
    segments: [
      {
        status: { type: String, required: true },
        start: { type: Date, required: true },
        end: { type: Date, required: true },
      },
    ],
  },
  { collection: 'dailyGpsReports', timestamps: true }
);

dailyGpsReportSchema.index(
  { vehicleNumberNormalized: 1, date: 1 },
  { unique: true, name: 'unique_vehicle_report_date' }
);

module.exports = mongoose.model('DailyGpsReport', dailyGpsReportSchema);

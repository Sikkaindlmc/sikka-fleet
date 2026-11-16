require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const GpsHistory = require('../models/GpsHistory');
const { generateFleetReport } = require('../services/reportCalculationService');
const { istDateString } = require('../services/gpsTimelineService');

async function main() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) throw new Error('MONGODB_URI must be set in backend/.env.');
  await mongoose.connect(mongoUri, {
    dbName: process.env.MONGODB_DB_NAME || undefined,
  });

  const earliest = await GpsHistory.findOne().sort({ gpsTimestamp: 1 }).select('gpsTimestamp');
  if (!earliest) throw new Error('GPS history is empty; report backfill cannot use invented or manual data.');
  const fromDate = process.argv.find((arg) => arg.startsWith('--from='))?.slice(7) ||
    istDateString(earliest.gpsTimestamp);
  const toDate = process.argv.find((arg) => arg.startsWith('--to='))?.slice(5) ||
    istDateString(new Date());
  const report = await generateFleetReport({
    fromDate,
    toDate,
    vehicleNumber: 'ALL',
    persist: true,
  });
  console.log(`Rebuilt ${report.totalRecords} vehicle-day reports (${fromDate} through ${toDate}, Asia/Kolkata).`);
}

main()
  .catch((error) => {
    console.error('[Daily GPS report backfill failed]', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState) await mongoose.disconnect();
  });

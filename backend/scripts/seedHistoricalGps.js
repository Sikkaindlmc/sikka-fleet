const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const connectDB = require('../config/db');

async function seedHistoricalGps() {
  await connectDB();
  console.log('[Seed Historical] Connected to MongoDB Atlas.');

  const Vehicle = require('../models/Vehicle');
  const Driver = require('../models/Driver');
  const Plant = require('../models/Plant');
  const PlantEntry = require('../models/PlantEntry');
  const VehicleLocation = require('../models/VehicleLocation');
  const DriverLocation = require('../models/DriverLocation');
  const VehicleCurrentStatus = require('../models/VehicleCurrentStatus');

  const teaPlant = await Plant.findOne({ plantName: 'Tea Plant' });
  const saltPlant = await Plant.findOne({ plantName: 'Salt Plant' });
  const dasnaPlant = await Plant.findOne({ plantName: { $regex: /dasna/i } });
  const vehicle = await Vehicle.findOne({ vehicleNumber: 'UP14GT0300' });
  const driver = await Driver.findOne({ driverName: 'Rajesh' });

  if (!vehicle || !teaPlant || !saltPlant) {
    console.error('Missing prerequisite records.');
    process.exit(1);
  }

  console.log(`Setting up historical records for vehicle ${vehicle.vehicleNumber} and driver ${driver?.driverName}...`);

  // Remove existing historical mock points for 25-30 Sep to prevent duplication
  const startSep = new Date('2026-09-24T18:30:00.000Z'); // 25-Sep 00:00 IST
  const endSep = new Date('2026-09-30T18:29:59.000Z');   // 30-Sep 23:59:59 IST

  await VehicleLocation.deleteMany({
    vehicleNumber: 'UP14GT0300',
    gpsDateTime: { $gte: startSep, $lte: endSep },
  });
  await PlantEntry.deleteMany({
    vehicleNumber: 'UP14GT0300',
    entryDateTime: { $gte: startSep, $lte: endSep },
  });
  if (driver) {
    await DriverLocation.deleteMany({
      dlNumber: driver.dlNumber,
      capturedAt: { $gte: startSep, $lte: endSep },
    });
  }

  const vLocations = [];
  const pEntries = [];
  const dLocations = [];

  // Helper to make IST Date
  function makeISTDate(year, month, day, hour, min, sec = 0) {
    // month is 1-indexed (e.g. 9 for Sept, 10 for Oct)
    const dStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}+05:30`;
    return new Date(dStr);
  }

  // --- 25 September: Movement at Tea Plant ---
  const d25_in = makeISTDate(2026, 9, 25, 10, 0);
  const d25_mid = makeISTDate(2026, 9, 25, 12, 30);
  const d25_out = makeISTDate(2026, 9, 25, 15, 30);
  vLocations.push(
    { vehicleId: vehicle._id, vehicleNumber: 'UP14GT0300', latitude: 28.6548, longitude: 77.4635, gpsDateTime: d25_in, source: 'WheelsEye GPS' },
    { vehicleId: vehicle._id, vehicleNumber: 'UP14GT0300', latitude: 28.6547, longitude: 77.4634, gpsDateTime: d25_mid, source: 'WheelsEye GPS' },
    { vehicleId: vehicle._id, vehicleNumber: 'UP14GT0300', latitude: 28.6120, longitude: 77.2950, gpsDateTime: d25_out, source: 'WheelsEye GPS' }
  );
  pEntries.push({
    vehicleId: vehicle._id,
    vehicleNumber: 'UP14GT0300',
    plantId: teaPlant._id,
    plantName: 'Tea Plant',
    entryDateTime: d25_in,
    latitude: 28.6548,
    longitude: 77.4635,
    distanceMeter: 45,
  });

  // --- 26 September: Salt Plant visit ---
  const d26_in = makeISTDate(2026, 9, 26, 11, 15);
  const d26_out = makeISTDate(2026, 9, 26, 16, 0);
  vLocations.push(
    { vehicleId: vehicle._id, vehicleNumber: 'UP14GT0300', latitude: 28.6377, longitude: 77.4426, gpsDateTime: d26_in, source: 'WheelsEye GPS' },
    { vehicleId: vehicle._id, vehicleNumber: 'UP14GT0300', latitude: 28.6376, longitude: 77.4425, gpsDateTime: makeISTDate(2026, 9, 26, 14, 0), source: 'WheelsEye GPS' },
    { vehicleId: vehicle._id, vehicleNumber: 'UP14GT0300', latitude: 28.5950, longitude: 77.3200, gpsDateTime: d26_out, source: 'WheelsEye GPS' }
  );
  pEntries.push({
    vehicleId: vehicle._id,
    vehicleNumber: 'UP14GT0300',
    plantId: saltPlant._id,
    plantName: 'Salt Plant',
    entryDateTime: d26_in,
    latitude: 28.6377,
    longitude: 77.4426,
    distanceMeter: 35,
  });

  // --- 27 September: Movement outside & Dasna Plant visit ---
  const d27_in = makeISTDate(2026, 9, 27, 9, 30);
  const d27_out = makeISTDate(2026, 9, 27, 13, 45);
  vLocations.push(
    { vehicleId: vehicle._id, vehicleNumber: 'UP14GT0300', latitude: 28.6855, longitude: 77.5294, gpsDateTime: d27_in, source: 'WheelsEye GPS' },
    { vehicleId: vehicle._id, vehicleNumber: 'UP14GT0300', latitude: 28.6010, longitude: 77.3500, gpsDateTime: d27_out, source: 'WheelsEye GPS' }
  );
  if (dasnaPlant) {
    pEntries.push({
      vehicleId: vehicle._id,
      vehicleNumber: 'UP14GT0300',
      plantId: dasnaPlant._id,
      plantName: 'DASNA Plant',
      entryDateTime: d27_in,
      latitude: 28.6855,
      longitude: 77.5294,
      distanceMeter: 60,
    });
  }

  // --- 28 September: Tea Plant visit ---
  const d28_in = makeISTDate(2026, 9, 28, 10, 45);
  const d28_out = makeISTDate(2026, 9, 28, 17, 15);
  vLocations.push(
    { vehicleId: vehicle._id, vehicleNumber: 'UP14GT0300', latitude: 28.6547, longitude: 77.4634, gpsDateTime: d28_in, source: 'WheelsEye GPS' },
    { vehicleId: vehicle._id, vehicleNumber: 'UP14GT0300', latitude: 28.6548, longitude: 77.4635, gpsDateTime: makeISTDate(2026, 9, 28, 14, 30), source: 'WheelsEye GPS' },
    { vehicleId: vehicle._id, vehicleNumber: 'UP14GT0300', latitude: 28.6000, longitude: 77.3000, gpsDateTime: d28_out, source: 'WheelsEye GPS' }
  );
  pEntries.push({
    vehicleId: vehicle._id,
    vehicleNumber: 'UP14GT0300',
    plantId: teaPlant._id,
    plantName: 'Tea Plant',
    entryDateTime: d28_in,
    latitude: 28.6547,
    longitude: 77.4634,
    distanceMeter: 40,
  });

  // --- 29 September: Exact scenario specified in requirements ---
  // Multiple Plant Visits:
  // Tea Plant: IN 09:15 AM, OUT 11:20 AM (Stay 2h 05m)
  // Nearest GPS at 11:28 AM: Tea Plant (lat: 28.6547, lon: 77.4634)
  // Salt Plant: IN 01:10 PM, OUT 04:45 PM (Stay 3h 35m)
  // Tea Plant second stay / OUT at 05:42 PM (Total stay: 6 Hours 14 Minutes)
  const d29_tea_1 = makeISTDate(2026, 9, 29, 9, 15);
  const d29_tea_out1 = makeISTDate(2026, 9, 29, 11, 20);
  const d29_nearest_1128 = makeISTDate(2026, 9, 29, 11, 28);
  const d29_salt_in = makeISTDate(2026, 9, 29, 13, 10);
  const d29_2pm = makeISTDate(2026, 9, 29, 14, 0);
  const d29_salt_out = makeISTDate(2026, 9, 29, 16, 45);
  const d29_tea_out2 = makeISTDate(2026, 9, 29, 17, 42);

  vLocations.push(
    { vehicleId: vehicle._id, vehicleNumber: 'UP14GT0300', latitude: 28.6548, longitude: 77.4635, gpsDateTime: d29_tea_1, source: 'WheelsEye GPS' },
    { vehicleId: vehicle._id, vehicleNumber: 'UP14GT0300', latitude: 28.6547, longitude: 77.4634, gpsDateTime: d29_tea_out1, source: 'WheelsEye GPS' },
    { vehicleId: vehicle._id, vehicleNumber: 'UP14GT0300', latitude: 28.6547, longitude: 77.4634, gpsDateTime: d29_nearest_1128, source: 'WheelsEye GPS' },
    { vehicleId: vehicle._id, vehicleNumber: 'UP14GT0300', latitude: 28.6377, longitude: 77.4426, gpsDateTime: d29_salt_in, source: 'WheelsEye GPS' },
    { vehicleId: vehicle._id, vehicleNumber: 'UP14GT0300', latitude: 28.6377, longitude: 77.4426, gpsDateTime: d29_2pm, source: 'WheelsEye GPS' },
    { vehicleId: vehicle._id, vehicleNumber: 'UP14GT0300', latitude: 28.6376, longitude: 77.4425, gpsDateTime: d29_salt_out, source: 'WheelsEye GPS' },
    { vehicleId: vehicle._id, vehicleNumber: 'UP14GT0300', latitude: 28.6547, longitude: 77.4634, gpsDateTime: d29_tea_out2, source: 'WheelsEye GPS' }
  );

  pEntries.push(
    {
      vehicleId: vehicle._id,
      vehicleNumber: 'UP14GT0300',
      plantId: teaPlant._id,
      plantName: 'Tea Plant',
      entryDateTime: d29_tea_1,
      latitude: 28.6548,
      longitude: 77.4635,
      distanceMeter: 48,
    },
    {
      vehicleId: vehicle._id,
      vehicleNumber: 'UP14GT0300',
      plantId: teaPlant._id,
      plantName: 'Tea Plant',
      entryDateTime: d29_nearest_1128,
      latitude: 28.6547,
      longitude: 77.4634,
      distanceMeter: 42,
    },
    {
      vehicleId: vehicle._id,
      vehicleNumber: 'UP14GT0300',
      plantId: saltPlant._id,
      plantName: 'Salt Plant',
      entryDateTime: d29_salt_in,
      latitude: 28.6377,
      longitude: 77.4426,
      distanceMeter: 38,
    }
  );

  // Driver Rajesh on 29 September:
  if (driver) {
    dLocations.push(
      {
        driverId: driver._id,
        driverName: driver.driverName,
        dlNumber: driver.dlNumber,
        mobileNumber: driver.mobileNumber,
        latitude: 28.6547,
        longitude: 77.4634,
        status: 'Location Deducted',
        currentStatus: 'Inside',
        plantId: teaPlant._id,
        plantName: 'Tea Plant',
        distanceToPlantMeters: 45,
        capturedAt: makeISTDate(2026, 9, 29, 11, 30),
      },
      {
        driverId: driver._id,
        driverName: driver.driverName,
        dlNumber: driver.dlNumber,
        mobileNumber: driver.mobileNumber,
        latitude: 28.6377,
        longitude: 77.4426,
        status: 'Location Deducted',
        currentStatus: 'Inside',
        plantId: saltPlant._id,
        plantName: 'Salt Plant',
        distanceToPlantMeters: 38,
        capturedAt: d29_2pm,
      }
    );
  }

  // --- 30 September: Movement ---
  const d30_in = makeISTDate(2026, 9, 30, 8, 45);
  const d30_out = makeISTDate(2026, 9, 30, 14, 20);
  vLocations.push(
    { vehicleId: vehicle._id, vehicleNumber: 'UP14GT0300', latitude: 28.6548, longitude: 77.4635, gpsDateTime: d30_in, source: 'WheelsEye GPS' },
    { vehicleId: vehicle._id, vehicleNumber: 'UP14GT0300', latitude: 28.6100, longitude: 77.3200, gpsDateTime: d30_out, source: 'WheelsEye GPS' }
  );
  pEntries.push({
    vehicleId: vehicle._id,
    vehicleNumber: 'UP14GT0300',
    plantId: teaPlant._id,
    plantName: 'Tea Plant',
    entryDateTime: d30_in,
    latitude: 28.6548,
    longitude: 77.4635,
    distanceMeter: 50,
  });

  // --- 05 October (Yesterday / Kal): Driver Rajesh at 3:00 PM ---
  if (driver) {
    const dYesterday3PM = makeISTDate(2026, 10, 5, 15, 0);
    dLocations.push({
      driverId: driver._id,
      driverName: driver.driverName,
      dlNumber: driver.dlNumber,
      mobileNumber: driver.mobileNumber,
      latitude: 28.6547,
      longitude: 77.4634,
      status: 'Location Deducted',
      currentStatus: 'Inside',
      plantId: teaPlant._id,
      plantName: 'Tea Plant',
      distanceToPlantMeters: 40,
      capturedAt: dYesterday3PM,
    });
  }

  // --- 06 October (Today / Aaj): UP14GT0300 at 10:29 AM at Tea Plant ---
  const dToday1029 = makeISTDate(2026, 10, 6, 10, 29);
  const dToday1030 = makeISTDate(2026, 10, 6, 10, 30);
  vLocations.push(
    { vehicleId: vehicle._id, vehicleNumber: 'UP14GT0300', latitude: 28.6547, longitude: 77.4634, gpsDateTime: dToday1029, source: 'WheelsEye GPS' },
    { vehicleId: vehicle._id, vehicleNumber: 'UP14GT0300', latitude: 28.6547, longitude: 77.4634, gpsDateTime: dToday1030, source: 'WheelsEye GPS' }
  );
  pEntries.push({
    vehicleId: vehicle._id,
    vehicleNumber: 'UP14GT0300',
    plantId: teaPlant._id,
    plantName: 'Tea Plant',
    entryDateTime: dToday1030,
    latitude: 28.6547,
    longitude: 77.4634,
    distanceMeter: 42,
  });

  await VehicleLocation.insertMany(vLocations);
  await PlantEntry.insertMany(pEntries);
  if (dLocations.length > 0) {
    await DriverLocation.insertMany(dLocations);
  }

  // Ensure UP14GT0300 current status is Inside Tea Plant
  await VehicleCurrentStatus.findOneAndUpdate(
    { vehicleId: vehicle._id },
    {
      vehicleId: vehicle._id,
      vehicleNumber: 'UP14GT0300',
      latitude: 28.6547,
      longitude: 77.4634,
      status: 'Inside',
      currentPlantId: teaPlant._id,
      distanceMeter: 42,
      lastEntryDateTime: dToday1030,
      lastUpdatedAt: new Date(),
    },
    { upsert: true }
  );

  console.log(`✅ Seeded ${vLocations.length} vehicle locations, ${pEntries.length} plant entries, and ${dLocations.length} driver locations.`);
  await mongoose.disconnect();
}

seedHistoricalGps().catch(console.error);

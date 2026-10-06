const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const connectDB = require('../config/db');

async function main() {
  await connectDB();
  const VehicleLocation = require('../models/VehicleLocation');
  const Vehicle = require('../models/Vehicle');
  const Driver = require('../models/Driver');
  const Plant = require('../models/Plant');
  const PlantEntry = require('../models/PlantEntry');

  const agg = await VehicleLocation.aggregate([
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$gpsDateTime', timezone: 'Asia/Kolkata' }
        },
        count: { $sum: 1 },
        vehicles: { $addToSet: '$vehicleNumber' }
      }
    },
    { $sort: { _id: 1 } }
  ]);
  console.log('VehicleLocation by IST date:');
  for (const item of agg) {
    console.log(`Date: ${item._id} -> Count: ${item.count}, Vehicles: ${item.vehicles.slice(0, 5).join(', ')}`);
  }

  const peAgg = await PlantEntry.aggregate([
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$entryDateTime', timezone: 'Asia/Kolkata' }
        },
        count: { $sum: 1 }
      }
    },
    { $sort: { _id: 1 } }
  ]);
  console.log('PlantEntry by IST date:', peAgg);

  const sampleVeh = await Vehicle.findOne({ vehicleNumber: 'UP14GT0300' });
  console.log('Vehicle UP14GT0300 exists:', !!sampleVeh);

  await mongoose.disconnect();
}

main().catch(console.error);

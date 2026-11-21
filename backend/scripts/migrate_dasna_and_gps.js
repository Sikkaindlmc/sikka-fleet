/**
 * Safe Migration Script: Remove DASNA Plant & Upgrade Fleet Vehicles for Multi-Provider GPS
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const Plant = require('../models/Plant');
const Vehicle = require('../models/Vehicle');
const User = require('../models/User');
const GpsSetting = require('../models/GpsSetting');

async function migrate() {
  console.log('Connecting to MongoDB Atlas...');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected successfully.\n');

  // 1. Remove DASNA Plant completely
  console.log('--- STEP 1: Removing DASNA Plant from Database ---');
  const dasnaPlant = await Plant.findOne({ plantName: /dasna/i });
  if (dasnaPlant) {
    const dasnaId = dasnaPlant._id;
    console.log(`Found DASNA Plant (ID: ${dasnaId}). Removing from User access permissions...`);

    // Pull from User accessPlants
    const userUpdate = await User.updateMany(
      { accessPlants: dasnaId },
      { $pull: { accessPlants: dasnaId } }
    );
    console.log(`Updated ${userUpdate.modifiedCount} user records.`);

    // Delete DASNA Plant document
    await Plant.deleteOne({ _id: dasnaId });
    console.log('DASNA Plant deleted from Plant collection.');
  } else {
    console.log('DASNA Plant is not present in Plant collection.');
  }

  // 2. Initialize GPS fields on existing Vehicle records
  console.log('\n--- STEP 2: Updating Existing Vehicle Records for Multi-Provider GPS ---');
  const vehicles = await Vehicle.find();
  let updatedCount = 0;
  for (const v of vehicles) {
    let modified = false;
    if (!v.gps_mode) {
      v.gps_mode = 'AUTO';
      modified = true;
    }
    if (!v.gps_provider) {
      v.gps_provider = (v.gpsProvider && v.gpsProvider.toLowerCase().includes('fleetx')) ? 'FLEETX' : 'WHEELSEYE';
      modified = true;
    }
    if (modified) {
      await v.save();
      updatedCount++;
    }
  }
  console.log(`Verified ${vehicles.length} vehicles. Updated ${updatedCount} vehicles with default GPS mode & provider.`);

  // 3. Ensure GpsSetting exists for both WheelsEye and FleetX
  console.log('\n--- STEP 3: Ensuring GpsSetting for WheelsEye and FleetX ---');
  await GpsSetting.findOneAndUpdate(
    { $or: [{ provider: /wheels/i }, { apiUrl: /wheelseye/i }] },
    {
      $set: {
        provider: 'WheelsEye GPS',
        apiUrl: process.env.WHEELSEYE_API_URL || 'https://api.wheelseye.com/currentLoc',
        status: 'Active',
        connectionStatus: 'Connected',
      },
    },
    { upsert: true }
  );

  await GpsSetting.findOneAndUpdate(
    { $or: [{ provider: /fleetx/i }, { apiUrl: /fleetx/i }] },
    {
      $set: {
        provider: 'FleetX',
        apiUrl: process.env.FLEETX_API_BASE_URL || 'https://api.fleetx.io',
        status: 'Active',
        connectionStatus: 'Connected',
      },
    },
    { upsert: true }
  );
  console.log('GpsSetting entries initialized.');

  console.log('\nMigration completed successfully.');
  await mongoose.disconnect();
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});

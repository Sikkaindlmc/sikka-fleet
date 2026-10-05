require('dotenv').config();
const mongoose = require('mongoose');
const axios = require('axios');
const Vehicle = require('../models/Vehicle');
const GpsSetting = require('../models/GpsSetting');
const VehicleCurrentStatus = require('../models/VehicleCurrentStatus');
const PlantEntry = require('../models/PlantEntry');
const VehicleLocation = require('../models/VehicleLocation');
const { processVehicleLocation } = require('../services/geofenceService');

const API_URL = 'https://api.wheelseye.com/currentLoc?accessToken=53afc208-0981-48c7-b134-d85d2f33dc0c';
const ACCESS_TOKEN = '53afc208-0981-48c7-b134-d85d2f33dc0c';

const connectDB = require('../config/db');

async function syncAndCleanVehicles() {
  try {
    await connectDB();
    console.log('[Sync] Connected to MongoDB Atlas.');

    // 1. Update GpsSetting
    await GpsSetting.deleteMany({});
    const gpsSetting = await GpsSetting.create({
      provider: 'WheelsEye GPS',
      apiUrl: API_URL,
      encryptedApiKey: ACCESS_TOKEN,
      status: 'Active',
      connectionStatus: 'Connected',
      lastSync: new Date(),
      pollIntervalSeconds: 15,
    });
    console.log('[Sync] Saved GpsSetting with WheelsEye API URL and Token.');

    // 2. Query WheelsEye API
    console.log('[Sync] Fetching vehicles from WheelsEye API...');
    const response = await axios.get(API_URL, { timeout: 15000 });

    if (!response.data || !response.data.data || !Array.isArray(response.data.data.list)) {
      throw new Error('Unexpected WheelsEye API response structure.');
    }

    const apiVehiclesList = response.data.data.list;
    console.log(`[Sync] Received ${apiVehiclesList.length} vehicles from WheelsEye API.`);

    const validVehicleNumbers = [];

    // 3. Upsert each API vehicle with BLANK Driver Name and Mobile
    for (const item of apiVehiclesList) {
      if (!item.vehicleNumber) continue;
      const vNum = item.vehicleNumber.trim().toUpperCase();
      validVehicleNumbers.push(vNum);

      let vehicle = await Vehicle.findOne({ vehicleNumber: vNum });
      if (!vehicle) {
        vehicle = await Vehicle.create({
          vehicleNumber: vNum,
          driverName: '', // BLANK as instructed by user
          mobile: '',     // BLANK as instructed by user
          fleetType: 'Own Fleet',
          ownerName: '',
          gpsDeviceId: item.deviceNumber || vNum,
          status: 'Active',
        });
        console.log(`[Sync] Created vehicle: ${vNum} with blank driver name.`);
      } else {
        // Keep existing driver name if user already updated, otherwise keep blank
        vehicle.status = 'Active';
        vehicle.gpsDeviceId = item.deviceNumber || vNum;
        await vehicle.save();
        console.log(`[Sync] Updated vehicle: ${vNum}`);
      }

      // Process location
      if (typeof item.latitude === 'number' && typeof item.longitude === 'number') {
        await processVehicleLocation(vehicle, item.latitude, item.longitude);
      }
    }

    // 4. Remove ALL OTHER vehicles not in WheelsEye API from application & database
    const deleteVehiclesResult = await Vehicle.deleteMany({
      vehicleNumber: { $nin: validVehicleNumbers },
    });
    console.log(`[Cleanup] Deleted ${deleteVehiclesResult.deletedCount} old/other vehicles not in API.`);

    // Clean orphaned current status & plant entries
    const remainingVehicleIds = (await Vehicle.find({}, '_id')).map((v) => v._id);
    const deletedStatuses = await VehicleCurrentStatus.deleteMany({
      vehicleId: { $nin: remainingVehicleIds },
    });
    const deletedEntries = await PlantEntry.deleteMany({
      vehicleId: { $nin: remainingVehicleIds },
    });
    console.log(`[Cleanup] Cleaned ${deletedStatuses.deletedCount} orphan status records, ${deletedEntries.deletedCount} entries.`);

    const totalVehicles = await Vehicle.countDocuments();
    console.log(`[Sync Completed] Database now has exactly ${totalVehicles} active vehicles, all from WheelsEye API.`);
    process.exit(0);
  } catch (error) {
    console.error('[Sync Error]:', error.message);
    process.exit(1);
  }
}

syncAndCleanVehicles();

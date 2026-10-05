const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Plant = require('../models/Plant');
const Vehicle = require('../models/Vehicle');
const GpsSetting = require('../models/GpsSetting');
const VehicleCurrentStatus = require('../models/VehicleCurrentStatus');
const PlantEntry = require('../models/PlantEntry');
const VehicleLocation = require('../models/VehicleLocation');
const { processVehicleLocation } = require('../services/geofenceService');

const connectDB = require('../config/db');

async function seedDatabase() {
  try {
    await connectDB();
    console.log('[Seed] Connected to MongoDB Atlas successfully.');

    // Clear existing collections
    await User.deleteMany({});
    await Plant.deleteMany({});
    await Vehicle.deleteMany({});
    await GpsSetting.deleteMany({});
    await VehicleCurrentStatus.deleteMany({});
    await PlantEntry.deleteMany({});
    await VehicleLocation.deleteMany({});
    console.log('[Seed] Cleared existing data.');

    // 1. Seed Plants
    const plants = await Plant.create([
      {
        plantName: 'Tea Plant',
        location: 'Sector 62, Noida, UP',
        radiusMeters: 500,
        latitude: 28.6280,
        longitude: 77.3670,
        status: 'Active',
      },
      {
        plantName: 'Salt Plant',
        location: 'Meerut Road Industrial Area, Ghaziabad, UP',
        radiusMeters: 600,
        latitude: 28.6820,
        longitude: 77.4420,
        status: 'Active',
      },
      {
        plantName: 'Ghaziabad Plant',
        location: 'Site IV Industrial Area, Sahibabad, Ghaziabad',
        radiusMeters: 750,
        latitude: 28.6650,
        longitude: 77.3450,
        status: 'Active',
      },
    ]);
    console.log(`[Seed] Created ${plants.length} plants.`);

    const teaPlant = plants.find((p) => p.plantName === 'Tea Plant');
    const saltPlant = plants.find((p) => p.plantName === 'Salt Plant');
    const gzPlant = plants.find((p) => p.plantName === 'Ghaziabad Plant');

    // 2. Seed Default Administrator & Operator
    // Full Name: Ajay Somra | Username: ajaysomra | Password: Somra@2012
    const adminPasswordHash = await bcrypt.hash('Somra@2012', 10);
    const operatorPasswordHash = await bcrypt.hash('Operator@123', 10);

    await User.create([
      {
        fullName: 'Ajay Somra',
        username: 'ajaysomra',
        passwordHash: adminPasswordHash,
        role: 'Admin',
        accessPages: ['Dashboard', 'Plant', 'Vehicle Register', 'GPS', 'User Management'],
        accessPlants: [teaPlant._id, saltPlant._id, gzPlant._id],
        status: 'Active',
      },
      {
        fullName: 'Tea Plant Operator',
        username: 'operator',
        passwordHash: operatorPasswordHash,
        role: 'User',
        accessPages: ['Dashboard', 'Plant'],
        accessPlants: [teaPlant._id],
        status: 'Active',
      },
    ]);
    console.log('[Seed] Created administrator (Ajay Somra / ajaysomra) and operator user accounts.');

    // 3. Seed Vehicles (WheelsEye Fleet)
    const wheelseyeVehicles = [
      'UP14HT0300', 'UP14FT9142', 'UP14GT3942', 'UP14HT0600', 'UP14FT9150',
      'UP14GT0100', 'UP14HT0100', 'UP14GT0600', 'UP14GT0300', 'UP14GT1442',
      'UP14HT0030', 'UP14NT9030', 'UP14PT9910', 'UP14PT9930', 'UP14NT9010',
      'UP14QT6066', 'UP14QT8088', 'UP14QT5055', 'UP14RT5550', 'UP14RT6660',
      'UP14JT8377',
    ];

    const vehicles = await Vehicle.create(
      wheelseyeVehicles.map((vNum) => ({
        vehicleNumber: vNum,
        driverName: '', // Blank as requested by user
        mobile: '',     // Blank as requested by user
        fleetType: 'Own Fleet',
        ownerName: '',
        gpsDeviceId: vNum,
        status: 'Active',
      }))
    );
    console.log(`[Seed] Created ${vehicles.length} vehicles from WheelsEye API with blank driver names.`);

    // 4. Seed GPS Settings (WheelsEye API)
    await GpsSetting.create({
      provider: 'WheelsEye GPS',
      apiUrl: 'https://api.wheelseye.com/currentLoc?accessToken=53afc208-0981-48c7-b134-d85d2f33dc0c',
      encryptedApiKey: '53afc208-0981-48c7-b134-d85d2f33dc0c',
      apiSecret: '',
      status: 'Active',
      connectionStatus: 'Connected',
      lastSync: new Date(),
      pollIntervalSeconds: 15,
    });
    console.log('[Seed] Created WheelsEye GPS settings.');

    // 5. Initial Geofenced Location distribution
    const baseDate = new Date('2026-09-21T10:15:00+05:30');

    // UP14AB1234 inside Tea Plant (~85m)
    await processVehicleLocation(vehicles[0], 28.6284, 77.3675, new Date(baseDate.getTime()), 'Initial Setup');

    // UP14CD5678 inside Tea Plant (~140m)
    await processVehicleLocation(vehicles[1], 28.6272, 77.3662, new Date(baseDate.getTime() + 27 * 60000), 'Initial Setup');

    // UP14EF9012 inside Salt Plant (~120m)
    await processVehicleLocation(vehicles[2], 28.6815, 77.4412, new Date(baseDate.getTime() + 50 * 60000), 'Initial Setup');

    // DL01XY7788 inside Ghaziabad Plant (~190m)
    await processVehicleLocation(vehicles[3], 28.6660, 77.3460, new Date(baseDate.getTime() + 75 * 60000), 'Initial Setup');

    // HR26AA1122 Outside (On NH9 Highway, ~4.5 km away)
    await processVehicleLocation(vehicles[4], 28.5950, 77.3200, new Date(baseDate.getTime() + 120 * 60000), 'Initial Setup');

    // UP16ZZ4455 Outside (Near Mayur Vihar, ~6 km away)
    await processVehicleLocation(vehicles[5], 28.6120, 77.2950, new Date(baseDate.getTime() + 130 * 60000), 'Initial Setup');

    console.log('[Seed] Successfully seeded all initial geofences and data!');
  } catch (error) {
    console.error('[Seed Error]:', error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

seedDatabase();

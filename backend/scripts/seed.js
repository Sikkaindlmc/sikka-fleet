const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Plant = require('../models/Plant');
const Vehicle = require('../models/Vehicle');
const VehicleCurrentStatus = require('../models/VehicleCurrentStatus');
const PlantEntry = require('../models/PlantEntry');
const VehicleLocation = require('../models/VehicleLocation');

const connectDB = require('../config/db');

async function seedDatabase() {
  if (process.env.NODE_ENV === 'production' || !process.argv.includes('--allow-seed')) {
    console.error('Refusing to overwrite fleet data. Use --allow-seed outside production only.');
    process.exitCode = 1;
    return;
  }

  try {
    await connectDB();
    console.log('[Seed] Connected to MongoDB Atlas successfully.');

    const plants = await Plant.find({ status: 'Active' });
    const dasnaPlant = plants.find((plant) => plant.plantName.toLowerCase().includes('dasna'));
    const saltPlant = plants.find((plant) => plant.plantName.toLowerCase().includes('salt'));
    const teaPlant = plants.find((plant) => plant.plantName.toLowerCase().includes('tea'));
    const requiredPlants = [dasnaPlant, saltPlant, teaPlant];
    if (requiredPlants.some((plant) => (
      !plant ||
      !Number.isFinite(plant.latitude) ||
      !Number.isFinite(plant.longitude) ||
      (plant.latitude === 0 && plant.longitude === 0) ||
      !Number.isFinite(plant.radiusMeters ?? plant.radiusMeter) ||
      (plant.radiusMeters ?? plant.radiusMeter) <= 0
    ))) {
      throw new Error('Create and verify the DASNA, Salt, and Tea Plant records in Plant Management before seeding users or vehicles.');
    }

    // Clear existing collections
    await User.deleteMany({});
    await Vehicle.deleteMany({});
    await VehicleCurrentStatus.deleteMany({});
    await PlantEntry.deleteMany({});
    await VehicleLocation.deleteMany({});
    console.log('[Seed] Cleared existing data.');

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
        accessPlants: [dasnaPlant._id, saltPlant._id, teaPlant._id],
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

    console.log('[Seed] Used the saved plant records and created account and vehicle records without synthetic GPS positions.');
  } catch (error) {
    console.error('[Seed Error]:', error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

seedDatabase();

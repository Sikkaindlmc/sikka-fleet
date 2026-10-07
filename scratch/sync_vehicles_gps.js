const path = require('path');
const connectDB = require(path.join(__dirname, '../backend/config/db'));
const Vehicle = require(path.join(__dirname, '../backend/models/Vehicle'));
const GpsSetting = require(path.join(__dirname, '../backend/models/GpsSetting'));
const VehicleCurrentStatus = require(path.join(__dirname, '../backend/models/VehicleCurrentStatus'));
const VehicleLocation = require(path.join(__dirname, '../backend/models/VehicleLocation'));
const PlantEntry = require(path.join(__dirname, '../backend/models/PlantEntry'));
const { fetchGpsLocations } = require(path.join(__dirname, '../backend/services/gpsSimulatorService'));

(async () => {
  try {
    await connectDB();
    const setting = await GpsSetting.findOne().sort({ updatedAt: -1 });
    const rawGpsPoints = await fetchGpsLocations(setting);
    console.log('[Sync] GPS returned points count:', rawGpsPoints.length);

    const gpsVehiclesMap = new Map();
    for (const pt of rawGpsPoints) {
      if (pt.vehicleNumber) {
        const vNum = pt.vehicleNumber.trim().toUpperCase();
        if (!gpsVehiclesMap.has(vNum)) {
          gpsVehiclesMap.set(vNum, pt);
        }
      }
    }
    const gpsVehicleNumbers = Array.from(gpsVehiclesMap.keys());
    console.log(`[Sync] Unique GPS vehicle numbers (${gpsVehicleNumbers.length}):`, gpsVehicleNumbers);

    let addedCount = 0;
    let updatedCount = 0;

    for (const [vNum, pt] of gpsVehiclesMap.entries()) {
      let vehicle = await Vehicle.findOne({ vehicleNumber: vNum });
      if (!vehicle) {
        vehicle = await Vehicle.create({
          vehicleNumber: vNum,
          driverName: '',
          mobile: '',
          fleetType: 'Own Fleet',
          ownerName: '',
          gpsDeviceId: pt.deviceNumber || vNum,
          status: 'Active',
        });
        await VehicleCurrentStatus.findOneAndUpdate(
          { vehicleId: vehicle._id },
          {
            vehicleId: vehicle._id,
            status: 'Outside',
            latitude: pt.latitude || 28.5355,
            longitude: pt.longitude || 77.3910,
            lastUpdatedAt: pt.timestamp || new Date(),
          },
          { upsert: true, new: true }
        );
        addedCount++;
        console.log(`[Sync] Added vehicle to registry: ${vNum}`);
      } else {
        if (pt.deviceNumber && vehicle.gpsDeviceId !== pt.deviceNumber) {
          vehicle.gpsDeviceId = pt.deviceNumber;
          await vehicle.save();
        }
        updatedCount++;
      }
    }

    // Delete vehicles NOT in GPS
    const vehiclesToDelete = await Vehicle.find({ vehicleNumber: { $nin: gpsVehicleNumbers } });
    console.log('[Sync] Vehicles to remove (not in GPS):', vehiclesToDelete.map((v) => v.vehicleNumber));

    const deleteIds = vehiclesToDelete.map((v) => v._id);
    if (deleteIds.length > 0) {
      await Vehicle.deleteMany({ _id: { $in: deleteIds } });
      await VehicleCurrentStatus.deleteMany({ vehicleId: { $in: deleteIds } });
      await VehicleLocation.deleteMany({ vehicleId: { $in: deleteIds } });
      await PlantEntry.deleteMany({ vehicleId: { $in: deleteIds } });
      console.log(`[Sync] Removed ${deleteIds.length} vehicles from database.`);
    }

    const currentVehicles = await Vehicle.find().sort({ vehicleNumber: 1 });
    console.log(`[Sync Complete] Total vehicles in registry: ${currentVehicles.length}`);
    console.log('Registered vehicles:', currentVehicles.map((v) => v.vehicleNumber));
    process.exit(0);
  } catch (err) {
    console.error('[Sync Error]:', err);
    process.exit(1);
  }
})();

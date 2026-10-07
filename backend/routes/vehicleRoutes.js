const express = require('express');
const Vehicle = require('../models/Vehicle');
const VehicleCurrentStatus = require('../models/VehicleCurrentStatus');
const VehicleLocation = require('../models/VehicleLocation');
const PlantEntry = require('../models/PlantEntry');
const { verifyToken, checkPageAccess } = require('../middleware/auth');

const router = express.Router();

// Require authenticated user with 'Vehicle Register' page permission
router.use(verifyToken, checkPageAccess('Vehicle Register'));

/**
 * Normalizes and formats a 10-digit mobile string to '+91 XXXXXXXXXX'
 */
function validateAndFormatMobile(mobile) {
  if (!mobile || typeof mobile !== 'string' || !mobile.trim()) {
    return '';
  }

  // Extract only digits, ignoring any leading +91 or non-digit chars
  let cleaned = mobile.replace(/^[+]?91/, '').replace(/\D/g, '');

  if (cleaned.length !== 10) {
    throw new Error('Mobile number must be exactly 10 digits if provided.');
  }

  return `+91 ${cleaned}`;
}

// GET /api/vehicles - List all vehicles
router.get('/', async (req, res) => {
  try {
    const vehicles = await Vehicle.find().sort({ createdAt: -1 });
    res.json(vehicles);
  } catch (error) {
    console.error('[Get Vehicles Error]:', error);
    res.status(500).json({ error: 'Failed to retrieve vehicles.' });
  }
});

// POST /api/vehicles - Add Vehicle
router.post('/', async (req, res) => {
  try {
    const { vehicleNumber, driverName, mobile, fleetType, ownerName, gpsDeviceId, status } = req.body;

    if (!vehicleNumber || !vehicleNumber.trim()) {
      return res.status(400).json({ error: 'Vehicle number is required.' });
    }

    const normalizedVehicleNumber = vehicleNumber.trim().toUpperCase().replace(/\s+/g, '');

    // Duplicate check
    const existingVehicle = await Vehicle.findOne({ vehicleNumber: normalizedVehicleNumber });
    if (existingVehicle) {
      return res.status(400).json({ error: `Vehicle with number '${normalizedVehicleNumber}' is already registered.` });
    }

    const finalDriverName = driverName ? driverName.trim() : '';

    let formattedMobile = '';
    try {
      formattedMobile = validateAndFormatMobile(mobile);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    if (!['Own Fleet', 'Hired', 'Rental'].includes(fleetType)) {
      return res.status(400).json({ error: 'Fleet type must be Own Fleet, Hired, or Rental.' });
    }

    let finalOwnerName = '';
    if (fleetType === 'Hired' || fleetType === 'Rental') {
      if (!ownerName || !ownerName.trim()) {
        return res.status(400).json({ error: `Owner name is required for '${fleetType}' vehicles.` });
      }
      finalOwnerName = ownerName.trim();
    }

    const newVehicle = await Vehicle.create({
      vehicleNumber: normalizedVehicleNumber,
      driverName: finalDriverName,
      mobile: formattedMobile,
      fleetType,
      ownerName: finalOwnerName,
      gpsDeviceId: gpsDeviceId ? gpsDeviceId.trim() : normalizedVehicleNumber,
      status: status === 'Inactive' ? 'Inactive' : 'Active',
    });

    // Create initial VehicleCurrentStatus record as Outside
    await VehicleCurrentStatus.findOneAndUpdate(
      { vehicleId: newVehicle._id },
      {
        vehicleId: newVehicle._id,
        status: 'Outside',
        latitude: 28.5355,
        longitude: 77.3910,
        lastUpdatedAt: new Date(),
      },
      { upsert: true, new: true }
    );

    res.status(201).json({
      message: 'Vehicle registered successfully',
      vehicle: newVehicle,
    });
  } catch (error) {
    console.error('[Create Vehicle Error]:', error);
    res.status(500).json({ error: 'Failed to register vehicle.' });
  }
});

// PUT /api/vehicles/:id - Edit Vehicle
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { vehicleNumber, driverName, mobile, fleetType, ownerName, gpsDeviceId, status } = req.body;

    const vehicle = await Vehicle.findById(id);
    if (!vehicle) {
      return res.status(404).json({ error: 'Vehicle not found.' });
    }

    if (!vehicleNumber || !vehicleNumber.trim()) {
      return res.status(400).json({ error: 'Vehicle number is required.' });
    }

    const normalizedVehicleNumber = vehicleNumber.trim().toUpperCase().replace(/\s+/g, '');

    // Duplicate check if changed
    const duplicate = await Vehicle.findOne({
      _id: { $ne: id },
      vehicleNumber: normalizedVehicleNumber,
    });
    if (duplicate) {
      return res.status(400).json({ error: `Vehicle number '${normalizedVehicleNumber}' is already in use.` });
    }

    const finalDriverName = driverName ? driverName.trim() : '';

    let formattedMobile = '';
    try {
      formattedMobile = validateAndFormatMobile(mobile);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    if (!['Own Fleet', 'Hired', 'Rental'].includes(fleetType)) {
      return res.status(400).json({ error: 'Fleet type must be Own Fleet, Hired, or Rental.' });
    }

    let finalOwnerName = '';
    if (fleetType === 'Hired' || fleetType === 'Rental') {
      if (!ownerName || !ownerName.trim()) {
        return res.status(400).json({ error: `Owner name is required for '${fleetType}' vehicles.` });
      }
      finalOwnerName = ownerName.trim();
    }

    vehicle.vehicleNumber = normalizedVehicleNumber;
    vehicle.driverName = finalDriverName;
    vehicle.mobile = formattedMobile;
    vehicle.fleetType = fleetType;
    vehicle.ownerName = finalOwnerName;
    if (gpsDeviceId !== undefined) {
      vehicle.gpsDeviceId = gpsDeviceId.trim();
    }
    vehicle.status = status === 'Inactive' ? 'Inactive' : 'Active';

    await vehicle.save();

    res.json({
      message: 'Vehicle updated successfully',
      vehicle,
    });
  } catch (error) {
    console.error('[Update Vehicle Error]:', error);
    res.status(500).json({ error: 'Failed to update vehicle.' });
  }
});

// DELETE /api/vehicles/:id - Delete Vehicle permanently & stop GPS tracking
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const vehicle = await Vehicle.findById(id);
    if (!vehicle) {
      return res.status(404).json({ error: 'Vehicle not found.' });
    }

    const vehicleNumber = vehicle.vehicleNumber;

    // 1. Delete vehicle document from registry
    await Vehicle.findByIdAndDelete(id);

    // 2. Remove associated current status, historical locations & geofence plant entries
    await VehicleCurrentStatus.deleteMany({ vehicleId: id });
    await VehicleLocation.deleteMany({ vehicleId: id });
    await PlantEntry.deleteMany({ vehicleId: id });

    // 3. Clear simulated states if present
    try {
      const { vehicleSimStates } = require('../services/gpsSimulatorService');
      if (vehicleSimStates && vehicleSimStates.has(id.toString())) {
        vehicleSimStates.delete(id.toString());
      }
    } catch (_) {}

    console.log(`[Vehicle Deleted]: ${vehicleNumber} (ID: ${id}) removed from registry. GPS tracking stopped.`);

    res.json({
      message: `Vehicle ${vehicleNumber} deleted successfully. GPS tracking has been stopped.`,
      deletedId: id,
      vehicleNumber,
    });
  } catch (error) {
    console.error('[Delete Vehicle Error]:', error);
    res.status(500).json({ error: 'Failed to delete vehicle.' });
  }
});

module.exports = router;

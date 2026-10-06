const express = require('express');
const Driver = require('../models/Driver');
const DriverLocation = require('../models/DriverLocation');
const DriverPlantRecord = require('../models/DriverPlantRecord');
const Vehicle = require('../models/Vehicle');
const { verifyToken, checkPageAccess } = require('../middleware/auth');
const {
  processDriverLocation,
  recordDriverLocationFailure,
  getDriverLocationSummary,
  STALE_THRESHOLD_MS,
} = require('../services/driverLocationService');

const router = express.Router();

// Helper to validate Indian 10-digit mobile number
const isValidIndianMobile = (mobile) => {
  if (!mobile) return false;
  const cleaned = mobile.toString().replace(/\D/g, '');
  return /^[6-9]\d{9}$/.test(cleaned);
};

// Require authenticated user/driver on all routes
router.use(verifyToken);

// =============================================================================
// DRIVER-SPECIFIC SELF-SERVICE ENDPOINTS (Authenticated Driver Only)
// Requirement 13, 14, 15, 16, 17, 18
// Driver ID is ALWAYS derived from verified token (req.user.id)
// =============================================================================

// GET /api/drivers/my-status - Retrieve authenticated driver's own live status
router.get('/my-status', async (req, res) => {
  try {
    const driverId = req.user.id || req.user._id;
    const driver = await Driver.findById(driverId);
    if (!driver) {
      return res.status(404).json({ error: 'Driver profile not found.' });
    }

    const summary = await getDriverLocationSummary(driver);
    res.json(summary);
  } catch (error) {
    console.error('[Driver Status Error]:', error);
    res.status(500).json({ error: 'Failed to retrieve driver location status.' });
  }
});

// POST /api/drivers/location - Driver 20-minute cycle & auto Plant IN/OUT update
router.post('/location', async (req, res) => {
  try {
    const authenticatedDriverId = (req.user.id || req.user._id).toString();

    // Requirement 18: Reject if client attempts to pass a different driverId
    if (req.body.driverId && req.body.driverId.toString() !== authenticatedDriverId) {
      return res.status(403).json({
        error: 'Forbidden: Driver identity must match the authenticated session. You cannot update location for another driver.',
        code: 'FORBIDDEN_DRIVER_MISMATCH',
      });
    }

    const { latitude, longitude, accuracy } = req.body;

    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      return res.status(400).json({
        error: 'Valid numeric latitude and longitude coordinates are required.',
      });
    }

    // Process driver position against plant geofences
    const summary = await processDriverLocation({
      driverId: authenticatedDriverId,
      latitude,
      longitude,
      accuracy: typeof accuracy === 'number' ? accuracy : null,
      timestamp: new Date(),
    });

    res.json({
      message: 'Driver location and plant status updated successfully.',
      ...summary,
    });
  } catch (error) {
    console.error('[Driver Location Update Error]:', error);
    res.status(500).json({ error: 'Failed to update driver location.' });
  }
});

// POST /api/drivers/location-failed - Record 20-minute GPS fetch failure without creating any location record
// Requirements 2, 3, 4: Never create location record, never use previous location, set status "Location Not Deducted"
router.post('/location-failed', async (req, res) => {
  try {
    const authenticatedDriverId = (req.user.id || req.user._id).toString();
    const { reason = 'GPS/location unavailable' } = req.body;

    const summary = await recordDriverLocationFailure({
      driverId: authenticatedDriverId,
      reason,
    });

    res.json({
      message: 'Location fetch failure recorded. No location record created.',
      status: 'Location Not Deducted',
      ...summary,
    });
  } catch (error) {
    console.error('[Driver Location Failed Error]:', error);
    res.status(500).json({ error: 'Failed to record location failure.' });
  }
});

// =============================================================================
// ADMINISTRATIVE DRIVER REGISTRY MANAGEMENT (Admin / Fleet Operators Only)
// Enforce 'Driver Registry' page access so Drivers CANNOT access other drivers
// =============================================================================
router.use(checkPageAccess('Driver Registry'));

// GET /api/drivers - List all registered drivers with optional filter/search
router.get('/', async (req, res) => {
  try {
    const { search, status } = req.query;
    const query = {};

    if (status && (status === 'Active' || status === 'Inactive')) {
      query.status = status;
    }

    if (search && search.trim()) {
      const regex = new RegExp(search.trim(), 'i');
      query.$or = [
        { driverName: regex },
        { dlNumber: regex },
        { mobileNumber: regex },
      ];
    }

    const drivers = await Driver.find(query).sort({ createdAt: -1 });

    const now = Date.now();
    const enrichedDrivers = drivers.map((driverDoc) => {
      const driver = driverDoc.toObject();
      const lastUpdate = driver.lastLocationUpdateAt ? new Date(driver.lastLocationUpdateAt).getTime() : null;
      // Valid deduction requires being within active 20-min cycle + grace threshold
      const isCurrent = lastUpdate && (now - lastUpdate) <= STALE_THRESHOLD_MS;
      const isDeducted = driver.locationDeductionStatus === 'Location Deducted' && isCurrent;

      return {
        ...driver,
        locationDeductionStatus: isDeducted ? 'Location Deducted' : 'Location Not Deducted',
        isLocationDeducted: isDeducted,
      };
    });

    res.json({
      totalCount: enrichedDrivers.length,
      drivers: enrichedDrivers,
    });
  } catch (error) {
    console.error('[Get Drivers Error]:', error);
    res.status(500).json({ error: 'Failed to retrieve driver registry.' });
  }
});

// GET /api/drivers/:id - Retrieve single driver details
router.get('/:id', async (req, res) => {
  try {
    const driver = await Driver.findById(req.params.id);
    if (!driver) {
      return res.status(404).json({ error: 'Driver record not found.' });
    }
    res.json(driver);
  } catch (error) {
    console.error('[Get Driver By ID Error]:', error);
    res.status(500).json({ error: 'Failed to retrieve driver details.' });
  }
});

// GET /api/drivers/:id/locations - Retrieve periodic 20-minute location history records
router.get('/:id/locations', async (req, res) => {
  try {
    const locations = await DriverLocation.find({ driverId: req.params.id })
      .sort({ capturedAt: -1 })
      .limit(50);
    res.json({
      totalCount: locations.length,
      locations,
    });
  } catch (error) {
    console.error('[Get Driver Locations Error]:', error);
    res.status(500).json({ error: 'Failed to retrieve driver location records.' });
  }
});

// POST /api/drivers - Register a new driver
router.post('/', async (req, res) => {
  try {
    const { driverName, dlNumber, dob, mobileNumber, status, photo } = req.body;

    if (!driverName || !driverName.trim()) {
      return res.status(400).json({ error: 'Driver Name is required.' });
    }

    if (!dlNumber || !dlNumber.trim()) {
      return res.status(400).json({ error: 'DL Number is required.' });
    }

    if (!dob) {
      return res.status(400).json({ error: 'Date of Birth (DOB) is required.' });
    }

    if (!mobileNumber || !mobileNumber.trim()) {
      return res.status(400).json({ error: 'Mobile Number is required.' });
    }

    // Validate photo size under 500 KB (Base64 string max ~700KB)
    if (photo && photo.length > 700 * 1024) {
      return res.status(400).json({ error: 'Driver photo size exceeds 500 KB limit. Please upload an image under 500 KB.' });
    }

    const cleanedMobile = mobileNumber.toString().replace(/\D/g, '');
    if (!isValidIndianMobile(cleanedMobile)) {
      return res.status(400).json({
        error: 'Invalid Mobile Number. Please enter a valid 10-digit Indian mobile number (e.g. 9876543210).',
      });
    }

    const cleanedDl = dlNumber.trim().toUpperCase();

    const existingDl = await Driver.findOne({ dlNumber: cleanedDl });
    if (existingDl) {
      return res.status(400).json({
        error: `DL Number '${cleanedDl}' is already registered with driver '${existingDl.driverName}'. Duplicate DL numbers are not allowed.`,
      });
    }

    const existingMobile = await Driver.findOne({ mobileNumber: cleanedMobile });
    if (existingMobile) {
      return res.status(400).json({
        error: `Mobile Number '${cleanedMobile}' is already registered with driver '${existingMobile.driverName}'. Duplicate mobile numbers are not allowed.`,
      });
    }

    const newDriver = await Driver.create({
      driverName: driverName.trim(),
      dlNumber: cleanedDl,
      dob: new Date(dob),
      mobileNumber: cleanedMobile,
      photo: photo || null,
      countryCode: '+91',
      status: status === 'Inactive' ? 'Inactive' : 'Active',
    });

    res.status(201).json({
      message: 'Driver registered successfully.',
      driver: newDriver,
    });
  } catch (error) {
    console.error('[Create Driver Error]:', error);
    if (error.code === 11000) {
      const isMobile = error.message?.includes('mobileNumber') || error.keyPattern?.mobileNumber;
      return res.status(400).json({
        error: isMobile
          ? 'Mobile Number is already registered with another driver. Duplicate entries are not allowed.'
          : 'DL Number is already registered with another driver. Duplicate entries are not allowed.',
      });
    }
    res.status(500).json({ error: 'Failed to create driver record.' });
  }
});

// PUT /api/drivers/:id - Update an existing driver
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { driverName, dlNumber, dob, mobileNumber, status, photo } = req.body;

    const driver = await Driver.findById(id);
    if (!driver) {
      return res.status(404).json({ error: 'Driver record not found.' });
    }

    if (!driverName || !driverName.trim()) {
      return res.status(400).json({ error: 'Driver Name is required.' });
    }

    if (!dlNumber || !dlNumber.trim()) {
      return res.status(400).json({ error: 'DL Number is required.' });
    }

    if (!dob) {
      return res.status(400).json({ error: 'Date of Birth (DOB) is required.' });
    }

    if (!mobileNumber || !mobileNumber.trim()) {
      return res.status(400).json({ error: 'Mobile Number is required.' });
    }

    // Validate photo size under 500 KB
    if (photo && photo.length > 700 * 1024) {
      return res.status(400).json({ error: 'Driver photo size exceeds 500 KB limit. Please upload an image under 500 KB.' });
    }

    const cleanedMobile = mobileNumber.toString().replace(/\D/g, '');
    if (!isValidIndianMobile(cleanedMobile)) {
      return res.status(400).json({
        error: 'Invalid Mobile Number. Please enter a valid 10-digit Indian mobile number.',
      });
    }

    const cleanedDl = dlNumber.trim().toUpperCase();

    if (cleanedDl !== driver.dlNumber) {
      const existingDl = await Driver.findOne({ dlNumber: cleanedDl, _id: { $ne: id } });
      if (existingDl) {
        return res.status(400).json({
          error: `DL Number '${cleanedDl}' is already registered with driver '${existingDl.driverName}'. Duplicate DL numbers are not allowed.`,
        });
      }
    }

    if (cleanedMobile !== driver.mobileNumber) {
      const existingMobile = await Driver.findOne({ mobileNumber: cleanedMobile, _id: { $ne: id } });
      if (existingMobile) {
        return res.status(400).json({
          error: `Mobile Number '${cleanedMobile}' is already registered with driver '${existingMobile.driverName}'. Duplicate mobile numbers are not allowed.`,
        });
      }
    }

    driver.driverName = driverName.trim();
    driver.dlNumber = cleanedDl;
    driver.dob = new Date(dob);
    driver.mobileNumber = cleanedMobile;
    if (photo !== undefined) {
      driver.photo = photo || null;
    }
    driver.status = status === 'Inactive' ? 'Inactive' : 'Active';

    await driver.save();

    res.json({
      message: 'Driver updated successfully.',
      driver,
    });
  } catch (error) {
    console.error('[Update Driver Error]:', error);
    if (error.code === 11000) {
      const isMobile = error.message?.includes('mobileNumber') || error.keyPattern?.mobileNumber;
      return res.status(400).json({
        error: isMobile
          ? 'Mobile Number is already registered with another driver. Duplicate entries are not allowed.'
          : 'DL Number is already registered with another driver. Duplicate entries are not allowed.',
      });
    }
    res.status(500).json({ error: 'Failed to update driver record.' });
  }
});

// DELETE /api/drivers/:id - Permanently delete a driver from project and database
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const driver = await Driver.findById(id);
    if (!driver) {
      return res.status(404).json({ error: 'Driver record not found.' });
    }

    const driverName = driver.driverName;
    const mobileNumber = driver.mobileNumber;

    // 1. Clear vehicle assignments where this driver was assigned
    await Vehicle.updateMany(
      {
        $or: [
          { driverName: new RegExp(`^${driverName}$`, 'i') },
          { mobile: mobileNumber },
        ],
      },
      {
        $set: { driverName: '', mobile: '' },
      }
    );

    // 2. Remove associated location and plant records for clean database
    await Promise.all([
      DriverLocation.deleteMany({
        $or: [
          { driverId: id },
          { mobileNumber: mobileNumber },
          { driverName: new RegExp(`^${driverName}$`, 'i') },
        ],
      }),
      DriverPlantRecord.deleteMany({
        $or: [
          { driverId: id },
          { driverMobile: mobileNumber },
          { driverName: new RegExp(`^${driverName}$`, 'i') },
        ],
      }),
    ]);

    // 3. Permanently delete the driver from Driver Registry
    await Driver.findByIdAndDelete(id);

    res.json({
      success: true,
      message: `Driver '${driverName}' permanently deleted from project and database.`,
      driverName,
    });
  } catch (error) {
    console.error('[Delete Driver Error]:', error);
    res.status(500).json({ error: 'Failed to permanently delete driver.' });
  }
});

module.exports = router;

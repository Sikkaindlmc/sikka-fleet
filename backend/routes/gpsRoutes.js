const express = require('express');
const GpsSetting = require('../models/GpsSetting');
const { verifyToken, checkPageAccess } = require('../middleware/auth');
const { syncGpsPositions, testGpsConnection } = require('../services/gpsPollerService');

const router = express.Router();

// GET /api/gps/vehicle-icon - Retrieve active vehicle icon for map & GPS (Available application-wide)
router.get('/vehicle-icon', async (req, res) => {
  try {
    const setting = await GpsSetting.findOne().sort({ updatedAt: -1 });
    res.json({
      vehicleIcon: setting?.vehicleIcon || '',
      updatedAt: setting?.vehicleIconUpdatedAt || null,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve vehicle icon.' });
  }
});

// Require authenticated user with 'GPS' page permission for administrative GPS configuration
router.use(verifyToken, checkPageAccess('GPS'));

// GET /api/gps - Retrieve current GPS configuration
router.get('/', async (req, res) => {
  try {
    let setting = await GpsSetting.findOne().sort({ updatedAt: -1 });

    if (!setting) {
      setting = await GpsSetting.create({
        provider: 'Fleet Telematics GPS Provider',
        apiUrl: 'https://api.telematics-provider.local/v1/vehicles',
        encryptedApiKey: 'sikka_live_gps_key_9948271',
        status: 'Active',
        connectionStatus: 'Connected',
        lastSync: new Date(),
        pollIntervalSeconds: 15,
      });
    }

    const maskedSetting = {
      _id: setting._id,
      provider: setting.provider,
      apiUrl: setting.apiUrl,
      status: setting.status,
      connectionStatus: setting.connectionStatus || 'Connected',
      lastSync: setting.lastSync,
      lastError: setting.lastError,
      pollIntervalSeconds: setting.pollIntervalSeconds,
      hasApiKey: Boolean(setting.encryptedApiKey),
      maskedApiKey: setting.encryptedApiKey
        ? `••••••••••••${setting.encryptedApiKey.slice(-4)}`
        : '',
      hasApiSecret: Boolean(setting.apiSecret),
      vehicleIcon: setting.vehicleIcon || '',
      vehicleIconUpdatedAt: setting.vehicleIconUpdatedAt || null,
      createdAt: setting.createdAt,
      updatedAt: setting.updatedAt,
    };

    res.json(maskedSetting);
  } catch (error) {
    console.error('[Get GPS Setting Error]:', error);
    res.status(500).json({ error: 'GPS service temporarily unavailable.' });
  }
});


// POST /api/gps/vehicle-icon - Upload new active vehicle icon
router.post('/vehicle-icon', async (req, res) => {
  try {
    const { vehicleIcon } = req.body;

    if (!vehicleIcon || !vehicleIcon.trim()) {
      return res.status(400).json({ error: 'Vehicle icon image data is required.' });
    }

    // Enforce under 1 MB limit (base64 string size ~1.4MB max)
    if (vehicleIcon.length > 1.45 * 1024 * 1024) {
      return res.status(400).json({ error: 'Vehicle icon size exceeds 1 MB limit. Please upload an image under 1 MB.' });
    }

    let setting = await GpsSetting.findOne().sort({ updatedAt: -1 });
    if (!setting) {
      setting = await GpsSetting.create({
        provider: 'WheelsEye GPS',
        vehicleIcon: vehicleIcon.trim(),
        vehicleIconUpdatedAt: new Date(),
      });
    } else {
      setting.vehicleIcon = vehicleIcon.trim();
      setting.vehicleIconUpdatedAt = new Date();
      await setting.save();
    }

    res.json({
      message: 'Vehicle icon uploaded successfully. It is now active across the application.',
      vehicleIcon: setting.vehicleIcon,
      updatedAt: setting.vehicleIconUpdatedAt,
    });
  } catch (error) {
    console.error('[Upload Vehicle Icon Error]:', error);
    res.status(500).json({ error: 'Failed to upload vehicle icon.' });
  }
});

// DELETE /api/gps/vehicle-icon - Reset vehicle icon to default
router.delete('/vehicle-icon', async (req, res) => {
  try {
    let setting = await GpsSetting.findOne().sort({ updatedAt: -1 });
    if (setting) {
      setting.vehicleIcon = '';
      setting.vehicleIconUpdatedAt = null;
      await setting.save();
    }

    res.json({
      message: 'Vehicle icon reset to system default.',
      vehicleIcon: '',
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to reset vehicle icon.' });
  }
});

// POST /api/gps - Save or update GPS configuration
router.post('/', async (req, res) => {
  try {
    const { provider, apiUrl, apiKey, apiSecret, status, pollIntervalSeconds } = req.body;

    if (!provider || !provider.trim()) {
      return res.status(400).json({ error: 'GPS Provider is required.' });
    }

    let setting = await GpsSetting.findOne().sort({ updatedAt: -1 });

    const updateData = {
      provider: provider.trim(),
      apiUrl: apiUrl ? apiUrl.trim() : '',
      status: status === 'Inactive' ? 'Inactive' : 'Active',
      pollIntervalSeconds: Number(pollIntervalSeconds) || 15,
    };

    if (apiKey && !apiKey.includes('••••')) {
      updateData.encryptedApiKey = apiKey.trim();
    }
    if (apiSecret && !apiSecret.includes('••••')) {
      updateData.apiSecret = apiSecret.trim();
    }

    if (setting) {
      Object.assign(setting, updateData);
      await setting.save();
    } else {
      setting = await GpsSetting.create(updateData);
    }

    res.json({
      message: 'GPS configuration saved successfully.',
      setting: {
        _id: setting._id,
        provider: setting.provider,
        apiUrl: setting.apiUrl,
        status: setting.status,
        connectionStatus: setting.connectionStatus,
        lastSync: setting.lastSync,
        lastError: setting.lastError,
        pollIntervalSeconds: setting.pollIntervalSeconds,
        hasApiKey: Boolean(setting.encryptedApiKey),
        maskedApiKey: setting.encryptedApiKey
          ? `••••••••••••${setting.encryptedApiKey.slice(-4)}`
          : '',
      },
    });
  } catch (error) {
    console.error('[Save GPS Setting Error]:', error);
    res.status(500).json({ error: 'Unable to connect to GPS provider.' });
  }
});

// POST /api/gps/test-connection - Test provider connection
router.post('/test-connection', async (req, res) => {
  try {
    const result = await testGpsConnection();
    res.json(result);
  } catch (error) {
    console.error('[Test GPS Connection Error]:', error);
    res.status(500).json({
      status: 'Connection Failed',
      message: 'Unable to connect to GPS provider.',
      lastError: error.message,
    });
  }
});

// POST /api/gps/trigger-sync - Manual GPS sync trigger
router.post('/trigger-sync', async (req, res) => {
  try {
    const result = await syncGpsPositions();
    res.json({
      message: 'GPS synchronization completed successfully.',
      ...result,
    });
  } catch (error) {
    console.error('[Trigger GPS Sync Error]:', error);
    res.status(500).json({ error: 'Unable to connect to GPS provider.' });
  }
});

// GET /api/gps/live-vehicles - Live vehicle stream with current loading & geofences
router.get('/live-vehicles', async (req, res) => {
  try {
    const Plant = require('../models/Plant');
    const Vehicle = require('../models/Vehicle');
    const VehicleCurrentStatus = require('../models/VehicleCurrentStatus');
    const { fetchGpsLocations } = require('../services/gpsSimulatorService');
    const { calculateHaversineDistance } = require('../services/geofenceService');

    const setting = await GpsSetting.findOne().sort({ updatedAt: -1 });
    const rawPoints = await fetchGpsLocations(setting);
    const activePlants = await Plant.find({ status: 'Active' });

    // Lookup existing vehicles and their status & plans
    const vehicles = await Vehicle.find();
    const vehicleByNum = new Map();
    for (const v of vehicles) {
      vehicleByNum.set(v.vehicleNumber.toUpperCase(), v);
    }

    const statuses = await VehicleCurrentStatus.find().populate('currentPlantId', 'plantName');
    const statusByVehId = new Map();
    for (const s of statuses) {
      statusByVehId.set(s.vehicleId.toString(), s);
    }

    const { getReadableLocation } = require('../services/locationHelper');

    const liveVehicles = rawPoints.map((pt) => {
      const vNum = pt.vehicleNumber ? pt.vehicleNumber.toUpperCase() : '';
      const matchedVeh = vehicleByNum.get(vNum);
      const matchedStatus = matchedVeh ? statusByVehId.get(matchedVeh._id.toString()) : null;

      // Geofence calculation
      let matchedPlant = null;
      let minDistance = Infinity;

      for (const plant of activePlants) {
        const radius = plant.radiusMeters || plant.radiusMeter || 500;
        const dist = calculateHaversineDistance(pt.latitude, pt.longitude, plant.latitude, plant.longitude);
        if (dist <= radius && dist < minDistance) {
          minDistance = dist;
          matchedPlant = plant;
        }
      }

      // Nearest plant overall for distance reference
      let nearestPlantName = '';
      let nearestDistance = Infinity;
      for (const plant of activePlants) {
        const dist = calculateHaversineDistance(pt.latitude, pt.longitude, plant.latitude, plant.longitude);
        if (dist < nearestDistance) {
          nearestDistance = dist;
          nearestPlantName = plant.plantName;
        }
      }

      const plans = matchedStatus && Array.isArray(matchedStatus.plans) ? matchedStatus.plans : [];
      const latestPlan = plans.length > 0 ? plans[plans.length - 1] : null;

      return {
        vehicleNumber: vNum,
        vehicleId: matchedVeh ? matchedVeh._id : null,
        driverName: matchedVeh ? matchedVeh.driverName : 'Fleet Driver',
        mobile: matchedVeh ? matchedVeh.mobile : '+91 9876543210',
        deviceNumber: pt.deviceNumber || 'N/A',
        vendorName: pt.vendorName || 'Vaibhav Sikka',
        vehicleType: pt.vehicleType || 'Commercial',
        latitude: pt.latitude,
        longitude: pt.longitude,
        speed: pt.speed || 0,
        ignition: pt.ignition,
        angle: pt.angle || 0,
        chargeOn: pt.chargeOn,
        timestamp: pt.timestamp,
        readableTime: pt.readableTime,
        readableLocation: getReadableLocation(pt.latitude, pt.longitude, activePlants),
        geofence: {
          status: matchedPlant ? 'Inside' : 'Outside',
          plantName: matchedPlant ? matchedPlant.plantName : 'Outside All Plants',
          distanceMeter: matchedPlant ? minDistance : nearestDistance,
          nearestPlant: nearestPlantName,
        },
        loadingPlan: {
          currentPlan: latestPlan ? latestPlan.planText : '',
          authorName: latestPlan ? latestPlan.authorName : '',
          createdAt: latestPlan ? latestPlan.createdAt : null,
          history: plans,
        },
      };
    });

    // Ensure all active fleet vehicles from current status are included in the live stream
    const presentNums = new Set(liveVehicles.map((v) => v.vehicleNumber.toUpperCase()));
    const populatedStatuses = await VehicleCurrentStatus.find()
      .populate('vehicleId', 'vehicleNumber driverName mobile fleetType ownerName status');

    for (const st of populatedStatuses) {
      if (!st.vehicleId || st.vehicleId.status !== 'Active') continue;
      const v = st.vehicleId;
      const vNum = (v.vehicleNumber || '').toUpperCase();
      if (vNum && !presentNums.has(vNum)) {
        let matchedPlant = null;
        let minDistance = Infinity;
        for (const plant of activePlants) {
          const radius = plant.radiusMeters || plant.radiusMeter || 500;
          const dist = calculateHaversineDistance(st.latitude, st.longitude, plant.latitude, plant.longitude);
          if (dist <= radius && dist < minDistance) {
            minDistance = dist;
            matchedPlant = plant;
          }
        }

        let nearestPlantName = '';
        let nearestDistance = Infinity;
        for (const plant of activePlants) {
          const dist = calculateHaversineDistance(st.latitude, st.longitude, plant.latitude, plant.longitude);
          if (dist < nearestDistance) {
            nearestDistance = dist;
            nearestPlantName = plant.plantName;
          }
        }

        const plans = Array.isArray(st.plans) ? st.plans : [];
        const latestPlan = plans.length > 0 ? plans[plans.length - 1] : null;

        liveVehicles.push({
          vehicleNumber: vNum,
          vehicleId: v._id,
          driverName: v.driverName || 'Fleet Driver',
          mobile: v.mobile || '+91 9876543210',
          deviceNumber: 'GPS-SIM-TRACK',
          vendorName: 'Sikka Fleet',
          vehicleType: v.fleetType || 'Commercial',
          latitude: st.latitude,
          longitude: st.longitude,
          speed: 0,
          ignition: false,
          angle: 0,
          chargeOn: true,
          timestamp: st.lastUpdatedAt || new Date(),
          readableTime: new Date(st.lastUpdatedAt || Date.now()).toLocaleString('en-IN', {
            timeZone: 'Asia/Kolkata',
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
          }),
          readableLocation: getReadableLocation(st.latitude, st.longitude, activePlants),
          geofence: {
            status: matchedPlant ? 'Inside' : 'Outside',
            plantName: matchedPlant ? matchedPlant.plantName : 'Outside All Plants',
            distanceMeter: matchedPlant ? minDistance : nearestDistance,
            nearestPlant: nearestPlantName,
          },
          loadingPlan: {
            currentPlan: latestPlan ? latestPlan.planText : '',
            authorName: latestPlan ? latestPlan.authorName : '',
            createdAt: latestPlan ? latestPlan.createdAt : null,
            history: plans,
          },
        });
        presentNums.add(vNum);
      }
    }

    res.json({
      totalCount: liveVehicles.length,
      provider: setting ? setting.provider : 'WheelsEye GPS',
      apiUrl: setting ? setting.apiUrl : '',
      lastSync: new Date(),
      vehicles: liveVehicles,
    });
  } catch (error) {
    console.error('[Live Vehicles Error]:', error);
    res.status(500).json({ error: 'Failed to retrieve live telemetry vehicles.' });
  }
});

module.exports = router;

const express = require('express');
const GpsSetting = require('../models/GpsSetting');
const { verifyToken, checkPageAccess, requireRole } = require('../middleware/auth');
const { testGpsConnection } = require('../services/gpsPollerService');
const { executeGpsSync } = require('../services/gpsSyncService');
const { generateFleetReport } = require('../services/reportCalculationService');
const { getFleetGpsSnapshot } = require('../services/gpsDataService');
const { filterActivePlans } = require('../utils/planHelper');

const router = express.Router();

const { maskUrlSecret, isSafeExternalUrl } = require('../utils/security');
const { gpsSyncLimiter } = require('../middleware/rateLimiter');

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
    const storedSettings = await GpsSetting.find();
    const settings = storedSettings.length > 0
      ? storedSettings
      : [
          {
            provider: 'WheelsEye GPS',
            apiUrl: process.env.WHEELSEYE_API_URL || '',
            status: 'Inactive',
            connectionStatus: 'Pending',
            pollIntervalSeconds: 1800,
            encryptedApiKey: process.env.WHEELSEYE_API_KEY || '',
          },
          {
            provider: 'Fleetx',
            apiUrl: process.env.FLEETX_API_URL || '',
            status: 'Inactive',
            connectionStatus: 'Pending',
            pollIntervalSeconds: 1800,
            encryptedApiKey: process.env.FLEETX_API_KEY || process.env.FLEETX_BEARER_TOKEN || '',
          },
        ];

    // Selected or active provider setting
    const requestedProvider = req.query.provider ? req.query.provider.toLowerCase() : null;
    let selectedSetting = null;
    if (requestedProvider) {
      selectedSetting = settings.find((s) => s.provider && s.provider.toLowerCase().includes(requestedProvider));
    }
    if (!selectedSetting) {
      selectedSetting = settings.find((s) => s.status === 'Active') || settings[0];
    }

    const mapSetting = (s) => ({
      _id: s._id,
      provider: s.provider,
      apiUrl: maskUrlSecret(s.apiUrl),
      status: s.status,
      connectionStatus: s.connectionStatus || 'Connected',
      lastSync: s.lastSync,
      lastError: s.lastError,
      pollIntervalSeconds: s.pollIntervalSeconds,
      hasApiKey: Boolean(s.encryptedApiKey),
      maskedApiKey: s.encryptedApiKey
        ? `••••••••••••${s.encryptedApiKey.slice(-4)}`
        : '',
      hasApiSecret: Boolean(s.apiSecret),
      vehicleIcon: s.vehicleIcon || '',
      vehicleIconUpdatedAt: s.vehicleIconUpdatedAt || null,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    });

    const maskedSetting = {
      ...mapSetting(selectedSetting),
      providers: settings.map(mapSetting),
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

    if (apiUrl && apiUrl.trim()) {
      if (!isSafeExternalUrl(apiUrl.trim())) {
        return res.status(400).json({
          error: 'Invalid API URL. Only secure public HTTP/HTTPS endpoints are permitted. Internal and private network IP addresses are forbidden.',
        });
      }
    }

    const providerClean = provider.trim();
    const isFleetx = providerClean.toLowerCase().includes('fleetx') || (apiUrl && apiUrl.includes('fleetx'));
    const query = isFleetx
      ? { $or: [{ provider: /fleetx/i }, { apiUrl: /fleetx/i }] }
      : { $or: [{ provider: /wheels/i }, { apiUrl: /wheelseye/i }] };

    let setting = await GpsSetting.findOne(query);

    const updateData = {
      provider: providerClean,
      status: status === 'Inactive' ? 'Inactive' : 'Active',
      pollIntervalSeconds: Number(pollIntervalSeconds) || 1800, // 30 Min mandatory
      connectionStatus: 'Pending',
      last_sync_status: 'IDLE',
      lastError: '',
    };

    if (apiUrl && !apiUrl.includes('••••')) {
      updateData.apiUrl = apiUrl.trim();
    }
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
      message: `${providerClean} configuration saved successfully.`,
      setting: {
        _id: setting._id,
        provider: setting.provider,
        apiUrl: maskUrlSecret(setting.apiUrl),
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
router.post('/test-connection', gpsSyncLimiter, async (req, res) => {
  try {
    const { provider } = req.body || {};
    const result = await testGpsConnection(provider);
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

// POST /api/gps/trigger-sync - On-demand GPS sync trigger
router.post('/trigger-sync', gpsSyncLimiter, requireRole('Admin'), async (req, res) => {
  try {
    const result = await executeGpsSync({
      source: 'GPS-AUTO',
      triggerType: 'USER_TRIGGER',
    });
    res.json({
      message: 'GPS synchronization completed successfully.',
      ...result,
    });
  } catch (error) {
    console.error('[Trigger GPS Sync Error]:', error);
    res.status(500).json({ error: 'Unable to connect to GPS provider.' });
  }
});

// GET /api/gps/live-vehicles - Live vehicle stream from verified GPS Single Source of Truth
router.get('/live-vehicles', async (req, res) => {
  try {
    const { getReadableLocation } = require('../services/locationHelper');

    const setting = await GpsSetting.findOne().sort({ updatedAt: -1 });
    const snapshot = await getFleetGpsSnapshot();
    const liveVehicles = snapshot.fleet.map((item) => {
      const v = item.vehicle;
      const st = item.storedStatus || {};
      const lat = item.latitude;
      const lon = item.longitude;
      const gpsTime = item.gpsTimestamp;
      const hasRawTelemetry = item.hasGps;

      const rawPlans = Array.isArray(st.plans) ? st.plans : [];
      const plans = filterActivePlans(rawPlans, item.status === 'Inside' ? 'Add Plan' : 'Next Trip Plan');
      const latestPlan = plans.length > 0 ? plans[plans.length - 1] : null;

      const readableTime = gpsTime
        ? new Date(gpsTime).toLocaleString('en-IN', {
            timeZone: 'Asia/Kolkata',
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
          })
        : '';
      return {
        vehicleNumber: v.vehicleNumber,
        vehicleId: v._id,
        driverName: v.driverName || 'N/A',
        mobile: v.mobile || '',
        deviceNumber: v.gpsDeviceId || 'N/A',
        vendorName: item.provider || 'GPS Provider',
        provider: item.provider || null,
        vehicleType: v.fleetType || 'N/A',
        latitude: lat,
        longitude: lon,
        speed: hasRawTelemetry ? item.speed : null,
        ignition: hasRawTelemetry ? item.ignition : null,
        movementStatus: st.movementStatus || null,
        dataCheck: false,
        angle: null,
        chargeOn: null,
        timestamp: gpsTime,
        readableTime,
        readableLocation: lat !== null && lon !== null && (lat !== 0 || lon !== 0)
          ? getReadableLocation(lat, lon, snapshot.plants)
          : 'N/A',
        gps_status: item.gpsStatus,
        stayHours: item.stayHours,
        geofence: {
          status: item.status,
          plantName: item.plantName || 'Outside All Plants',
          distanceMeter: item.distanceMeter,
          nearestPlant: '',
        },
        loadingPlan: {
          currentPlan: latestPlan ? latestPlan.planText : '',
          authorName: latestPlan ? latestPlan.authorName : '',
          createdAt: latestPlan ? latestPlan.createdAt : null,
          history: plans,
        },
      };
    });

    res.json({
      totalCount: liveVehicles.length,
      provider: setting ? setting.provider : 'WheelsEye GPS',
      apiUrl: setting ? maskUrlSecret(setting.apiUrl) : '',
      lastSync: snapshot.lastUpdated || setting?.lastSync || null,
      vehicles: liveVehicles,
    });
  } catch (error) {
    console.error('[Live Vehicles Error]:', error);
    res.status(500).json({ error: 'Failed to retrieve live telemetry vehicles.' });
  }
});

router.get('/daily-report', async (req, res) => {
  try {
    const { from, to, vehicleNumber } = req.query;
    if (!from || !to) {
      return res.status(400).json({ error: 'Query parameters "from" and "to" (YYYY-MM-DD) are required.' });
    }
    const report = await generateFleetReport({
      fromDate: from,
      toDate: to,
      vehicleNumber: vehicleNumber && vehicleNumber.trim() !== '' ? vehicleNumber : 'ALL',
    });
    res.json(report);
  } catch (error) {
    console.error('[Daily Report Error]:', error);
    res.status(500).json({ error: error.message || 'Failed to generate daily report.' });
  }
});

module.exports = router;

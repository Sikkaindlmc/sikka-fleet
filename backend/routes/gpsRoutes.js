const express = require('express');
const GpsSetting = require('../models/GpsSetting');
const { verifyToken, checkPageAccess, requireRole } = require('../middleware/auth');
const { testGpsConnection } = require('../services/gpsPollerService');
const {
  DEFAULT_FLEETX_URL,
  executeGpsSync,
  executeGpsSyncForBothProviders,
  fetchFleetxTelemetry,
  getGpsProvider,
} = require('../services/gpsSyncService');
const { generateFleetReport } = require('../services/reportCalculationService');
const { getFleetGpsSnapshot } = require('../services/gpsDataService');
const { filterActivePlans } = require('../utils/planHelper');

const router = express.Router();

const { maskUrlSecret, isSafeExternalUrl } = require('../utils/security');
const { gpsSyncLimiter } = require('../middleware/rateLimiter');
const {
  decryptGpsCredential,
  encryptGpsCredential,
  maskGpsCredential,
} = require('../utils/gpsCredentialCrypto');

function getClientApiUrl(setting) {
  if (!setting?.apiUrl) return '';
  let url = setting.apiUrl;
  if (setting.encryptedApiKey) {
    try {
      const parsed = new URL(url);
      if (!parsed.searchParams.has('accessToken')) {
        parsed.searchParams.set('accessToken', decryptGpsCredential(setting.encryptedApiKey));
        url = parsed.toString();
      }
    } catch (_) {
      return maskUrlSecret(url);
    }
  }
  return maskUrlSecret(url);
}

function getEffectiveGpsCredential(setting) {
  const envApiKey = (process.env.WHEELSEYE_API_KEY || '').trim();
  let envUrlToken = '';
  let savedUrlToken = '';
  try {
    const url = new URL(process.env.WHEELSEYE_API_URL || '');
    for (const key of ['accessToken', 'access_token', 'apiKey', 'api_key', 'token', 'key', 'secret']) {
      envUrlToken = url.searchParams.get(key) || '';
      if (envUrlToken) break;
    }
  } catch (_) {}
  try {
    const url = new URL(setting?.apiUrl || '');
    for (const key of ['accessToken', 'access_token', 'apiKey', 'api_key', 'token', 'key', 'secret']) {
      savedUrlToken = url.searchParams.get(key) || '';
      if (savedUrlToken) break;
    }
  } catch (_) {}
  const savedCredential = decryptGpsCredential(setting?.encryptedApiKey || '');
  return {
    credential: envApiKey || envUrlToken || savedCredential || savedUrlToken,
    source: envApiKey
      ? 'WHEELSEYE_API_KEY'
      : envUrlToken
        ? 'WHEELSEYE_API_URL query'
        : savedCredential
          ? 'GPS settings'
          : savedUrlToken
            ? 'GPS settings URL query'
          : 'none',
  };
}

function isCredentialEncryptionError(error) {
  return String(error?.message || '').includes('GPS_CREDENTIAL_ENCRYPTION_KEY');
}

function getProviderSettingQuery(provider) {
  const providerPattern = new RegExp(provider === 'Fleetx' ? 'fleetx' : 'wheels.?eye', 'i');
  return {
    archived: { $ne: true },
    $or: [{ provider: providerPattern }, { apiUrl: providerPattern }],
  };
}

function getProviderCredential(setting, provider) {
  if (provider === 'Fleetx') {
    const apiKey = (process.env.FLEETX_API_KEY || process.env.FLEETX_BEARER_TOKEN || '').trim() ||
      decryptGpsCredential(setting?.encryptedApiKey || '').trim();
    return {
      credential: apiKey,
      source: (process.env.FLEETX_API_KEY || '').trim()
        ? 'FLEETX_API_KEY'
        : (process.env.FLEETX_BEARER_TOKEN || '').trim()
          ? 'FLEETX_BEARER_TOKEN'
          : apiKey ? 'GPS settings' : 'none',
    };
  }
  return getEffectiveGpsCredential(setting);
}

function getProviderApiUrl(setting, provider) {
  if (provider === 'Fleetx') {
    return (process.env.FLEETX_API_URL || '').trim() ||
      setting?.apiUrl ||
      DEFAULT_FLEETX_URL;
  }
  return (process.env.WHEELSEYE_API_URL || '').trim() || getClientApiUrl(setting);
}

function serializeProviderSetting(setting, provider) {
  const credential = getProviderCredential(setting, provider);
  return {
    _id: setting?._id,
    provider,
    apiUrl: maskUrlSecret(getProviderApiUrl(setting, provider)),
    status: setting?.status || 'Active',
    connectionStatus: setting?.connectionStatus || 'Pending',
    lastSync: setting?.lastSync || null,
    lastSuccessAt: setting?.lastSuccessAt || null,
    lastErrorAt: setting?.lastErrorAt || null,
    lastErrorCode: setting?.lastErrorCode || '',
    lastError: setting?.lastError || '',
    consecutiveFailures: setting?.consecutiveFailures || 0,
    pollIntervalSeconds: setting?.pollIntervalSeconds || 1800,
    hasApiKey: Boolean(credential.credential),
    maskedApiKey: maskGpsCredential(credential.credential),
    credentialSource: credential.source,
  };
}

// GET /api/gps/vehicle-icon - Retrieve active vehicle icon for map & GPS (Available application-wide)
router.get('/vehicle-icon', async (req, res) => {
  try {
    const setting = await GpsSetting.findOne({
      archived: { $ne: true },
      $or: [{ provider: /wheels.?eye/i }, { apiUrl: /wheelseye/i }],
    }).sort({ updatedAt: -1 });
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
    const setting = await GpsSetting.findOne({
      archived: { $ne: true },
      $or: [{ provider: /wheels/i }, { apiUrl: /wheelseye/i }],
    }).sort({ updatedAt: -1 });
    const effectiveUrl = (process.env.WHEELSEYE_API_URL || '').trim() || getClientApiUrl(setting);
    const effectiveCredential = getEffectiveGpsCredential(setting);
    res.json({
      _id: setting?._id,
      provider: 'WheelsEye GPS',
      apiUrl: maskUrlSecret(effectiveUrl),
      status: setting?.status || 'Active',
      connectionStatus: setting?.connectionStatus || 'Pending',
      lastSync: setting?.lastSync || null,
      lastSuccessAt: setting?.lastSuccessAt || null,
      lastErrorAt: setting?.lastErrorAt || null,
      lastErrorCode: setting?.lastErrorCode || '',
      lastError: setting?.lastError || '',
      consecutiveFailures: setting?.consecutiveFailures || 0,
      pollIntervalSeconds: setting?.pollIntervalSeconds || 1800,
      hasApiKey: Boolean(effectiveCredential.credential),
      maskedApiKey: maskGpsCredential(effectiveCredential.credential),
      credentialSource: effectiveCredential.source,
      vehicleIcon: setting?.vehicleIcon || '',
      vehicleIconUpdatedAt: setting?.vehicleIconUpdatedAt || null,
      createdAt: setting?.createdAt,
      updatedAt: setting?.updatedAt,
    });
  } catch (error) {
    const encryptionError = isCredentialEncryptionError(error);
    res.status(encryptionError ? 503 : 500).json({
      error: encryptionError
        ? 'GPS credential encryption is not configured correctly. Set GPS_CREDENTIAL_ENCRYPTION_KEY to a valid 32-byte key.'
        : 'GPS service temporarily unavailable.',
    });
  }
});

router.get('/providers', async (req, res) => {
  try {
    const [wheelsEyeSetting, fleetxSetting] = await Promise.all([
      GpsSetting.findOne(getProviderSettingQuery('WheelsEye GPS')).sort({ updatedAt: -1 }),
      GpsSetting.findOne(getProviderSettingQuery('Fleetx')).sort({ updatedAt: -1 }),
    ]);
    res.json({
      providers: [
        serializeProviderSetting(wheelsEyeSetting, 'WheelsEye GPS'),
        serializeProviderSetting(fleetxSetting, 'Fleetx'),
      ],
    });
  } catch (error) {
    const encryptionError = isCredentialEncryptionError(error);
    res.status(encryptionError ? 503 : 500).json({
      error: encryptionError
        ? 'GPS credential encryption is not configured correctly.'
        : 'Failed to retrieve GPS provider settings.',
    });
  }
});

router.post('/providers/:provider', async (req, res) => {
  try {
    const provider = getGpsProvider(req.params.provider);
    const { apiUrl, apiKey, status, pollIntervalSeconds } = req.body;
    const currentSetting = await GpsSetting.findOne(getProviderSettingQuery(provider)).sort({ updatedAt: -1 });
    const update = {
      provider,
      status: status === 'Inactive' ? 'Inactive' : 'Active',
      connectionStatus: 'Pending',
      pollIntervalSeconds: Number(pollIntervalSeconds) || 1800,
    };

    if (typeof apiUrl === 'string' && apiUrl.trim() && !apiUrl.includes('••••')) {
      const parsedUrl = new URL(apiUrl.trim());
      if (!isSafeExternalUrl(parsedUrl.toString())) {
        return res.status(400).json({ error: 'Invalid provider API URL. Only secure public HTTP/HTTPS endpoints are permitted.' });
      }
      const urlCredentials = [];
      for (const key of ['accessToken', 'access_token', 'apiKey', 'api_key', 'token', 'key', 'secret']) {
        if (parsedUrl.searchParams.has(key)) {
          urlCredentials.push(parsedUrl.searchParams.get(key) || '');
          parsedUrl.searchParams.delete(key);
        }
      }
      update.apiUrl = parsedUrl.toString();
      const suppliedCredential = typeof apiKey === 'string' && apiKey.trim() && !apiKey.includes('••••')
        ? apiKey.trim()
        : urlCredentials.find(Boolean);
      if (suppliedCredential) update.encryptedApiKey = encryptGpsCredential(suppliedCredential);
    } else if (typeof apiKey === 'string' && apiKey.trim() && !apiKey.includes('••••')) {
      update.encryptedApiKey = encryptGpsCredential(apiKey.trim());
    }

    const setting = await GpsSetting.findOneAndUpdate(
      getProviderSettingQuery(provider),
      { $set: update },
      { new: true, upsert: true, runValidators: true }
    );
    res.json({
      message: `${provider} settings saved successfully.`,
      setting: serializeProviderSetting(setting || currentSetting, provider),
    });
  } catch (error) {
    const encryptionError = isCredentialEncryptionError(error);
    res.status(encryptionError ? 503 : 400).json({
      error: encryptionError
        ? 'GPS credential encryption is not configured correctly.'
        : error.message || 'Unable to save GPS provider settings.',
    });
  }
});

router.post('/providers/:provider/test-connection', gpsSyncLimiter, async (req, res) => {
  try {
    const provider = getGpsProvider(req.params.provider);
    const setting = await GpsSetting.findOne(getProviderSettingQuery(provider)).sort({ updatedAt: -1 });
    const result = provider === 'Fleetx'
      ? await fetchFleetxTelemetry(setting ? [setting] : [])
      : await testGpsConnection();
    const now = new Date();
    await GpsSetting.findOneAndUpdate(
      getProviderSettingQuery(provider),
      {
        $set: {
          provider,
          connectionStatus: 'Connected',
          lastSync: now,
          lastSuccessAt: now,
          lastError: '',
          consecutiveFailures: 0,
        },
      },
      { upsert: true }
    );
    res.json({
      status: 'Connected',
      provider,
      count: result.vehicles?.length ?? result.count ?? 0,
      message: `${provider} connection verified.`,
    });
  } catch (error) {
    const provider = (() => {
      try { return getGpsProvider(req.params.provider); } catch (_) { return 'GPS Provider'; }
    })();
    const statusCode = error.fleetxStatus?.status || error.wheelsEyeStatus?.status || error.response?.status || 'REQUEST_FAILED';
    await GpsSetting.findOneAndUpdate(
      getProviderSettingQuery(provider),
      {
        $set: {
          provider,
          connectionStatus: error.fleetxStatus?.authFailed || error.wheelsEyeStatus?.authFailed ? 'AUTH_FAILED' : 'Connection Failed',
          lastError: error.message || `${provider} request failed.`,
          lastErrorAt: new Date(),
          lastErrorCode: String(statusCode),
        },
        $inc: { consecutiveFailures: 1 },
      },
      { upsert: true }
    );
    res.status(502).json({
      status: 'Connection Failed',
      provider,
      httpStatus: error.response?.status || null,
      message: error.message || `${provider} connection failed.`,
    });
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

    let setting = await GpsSetting.findOne({
      archived: { $ne: true },
      $or: [{ provider: /wheels.?eye/i }, { apiUrl: /wheelseye/i }],
    }).sort({ updatedAt: -1 });
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
    let setting = await GpsSetting.findOne({
      archived: { $ne: true },
      $or: [{ provider: /wheels.?eye/i }, { apiUrl: /wheelseye/i }],
    }).sort({ updatedAt: -1 });
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
    const { apiUrl, apiKey, status, pollIntervalSeconds } = req.body;

    if (apiUrl && apiUrl.trim()) {
      if (!isSafeExternalUrl(apiUrl.trim())) {
        return res.status(400).json({
          error: 'Invalid API URL. Only secure public HTTP/HTTPS endpoints are permitted. Internal and private network IP addresses are forbidden.',
        });
      }
    }

    const providerClean = 'WheelsEye GPS';
    const query = {
      archived: { $ne: true },
      $or: [{ provider: /wheels/i }, { apiUrl: /wheelseye/i }],
    };

    let setting = await GpsSetting.findOne(query);

    const updateData = {
      provider: providerClean,
      status: status === 'Inactive' ? 'Inactive' : 'Active',
      pollIntervalSeconds: Number(pollIntervalSeconds) || 1800, // 30 Min mandatory
      connectionStatus: 'Pending',
      last_sync_status: 'IDLE',
      lastError: '',
    };

    let urlCredential = '';
    if (apiUrl && !apiUrl.includes('••••')) {
      const parsedUrl = new URL(apiUrl.trim());
      for (const key of ['accessToken', 'access_token', 'apiKey', 'api_key', 'token', 'key', 'secret']) {
        if (parsedUrl.searchParams.has(key)) {
          urlCredential = parsedUrl.searchParams.get(key) || '';
          parsedUrl.searchParams.delete(key);
        }
      }
      updateData.apiUrl = parsedUrl.toString();
    }
    if (apiKey && !apiKey.includes('••••')) {
      updateData.encryptedApiKey = encryptGpsCredential(apiKey.trim());
    } else if (urlCredential) {
      updateData.encryptedApiKey = encryptGpsCredential(urlCredential);
    }
    if (setting) {
      Object.assign(setting, updateData);
      await setting.save();
    } else {
      setting = await GpsSetting.create(updateData);
    }

    const effectiveCredential = getEffectiveGpsCredential(setting);
    res.json({
      message: `${providerClean} configuration saved successfully.`,
      setting: {
        _id: setting._id,
        provider: setting.provider,
        apiUrl: maskUrlSecret(
          process.env.WHEELSEYE_API_URL?.trim() ||
          getClientApiUrl(setting)
        ),
        status: setting.status,
        connectionStatus: setting.connectionStatus,
        lastSync: setting.lastSync,
        pollIntervalSeconds: setting.pollIntervalSeconds,
        hasApiKey: Boolean(effectiveCredential.credential),
        maskedApiKey: maskGpsCredential(effectiveCredential.credential),
        credentialSource: effectiveCredential.source,
        lastSuccessAt: setting.lastSuccessAt || null,
        lastErrorAt: setting.lastErrorAt || null,
        lastErrorCode: setting.lastErrorCode || '',
        consecutiveFailures: setting.consecutiveFailures || 0,
      },
    });
  } catch (error) {
    const encryptionError = isCredentialEncryptionError(error);
    res.status(encryptionError ? 503 : 500).json({
      error: encryptionError
        ? 'GPS credential encryption is not configured correctly. Set GPS_CREDENTIAL_ENCRYPTION_KEY to a valid 32-byte key.'
        : 'Unable to save GPS provider settings.',
    });
  }
});

// POST /api/gps/test-connection - Test WheelsEye connection
router.post('/test-connection', gpsSyncLimiter, async (req, res) => {
  try {
    const result = await testGpsConnection();
    res.status(result.status === 'Connected' ? 200 : 502).json(result);
  } catch (error) {
    const encryptionError = isCredentialEncryptionError(error);
    res.status(500).json({
      status: 'Connection Failed',
      message: encryptionError
        ? 'GPS credential encryption is not configured correctly. Set GPS_CREDENTIAL_ENCRYPTION_KEY to a valid 32-byte key.'
        : 'Unable to connect to WheelsEye.',
      reason: encryptionError ? 'GPS credential encryption configuration error' : 'Internal connection test error',
    });
  }
});

// POST /api/gps/trigger-sync - On-demand GPS sync trigger
router.post('/trigger-sync', gpsSyncLimiter, requireRole('Admin'), async (req, res) => {
  try {
    const requestedProvider = typeof req.body?.provider === 'string' ? req.body.provider : 'WheelsEye GPS';
    const result = requestedProvider.toLowerCase() === 'both'
      ? await executeGpsSyncForBothProviders({
          source: 'GPS-AUTO',
          triggerType: 'USER_TRIGGER',
        })
      : await executeGpsSync({
          source: 'GPS-AUTO',
          triggerType: 'USER_TRIGGER',
          provider: getGpsProvider(requestedProvider),
        });
    const isBothProviders = requestedProvider.toLowerCase() === 'both';
    res.status(result.success ? 200 : isBothProviders ? 207 : 502).json({
      message: result.message || `${result.provider} synchronization ${result.success ? 'completed' : 'failed'}.`,
      ...result,
    });
  } catch (error) {
    console.error('[Trigger GPS Sync Error]:', error);
    res.status(502).json({
      error: error.message || 'GPS synchronization failed.',
      provider: error.provider || null,
      providerStatus: error.providerStatus || null,
    });
  }
});

// GET /api/gps/live-vehicles - Live vehicle stream from verified GPS Single Source of Truth
router.get('/live-vehicles', async (req, res) => {
  try {
    const { getReadableLocation } = require('../services/locationHelper');

    const [setting, fleetxSetting] = await Promise.all([
      GpsSetting.findOne(getProviderSettingQuery('WheelsEye GPS')).sort({ updatedAt: -1 }),
      GpsSetting.findOne(getProviderSettingQuery('Fleetx')).sort({ updatedAt: -1 }),
    ]);
    const snapshot = await getFleetGpsSnapshot();
    const liveFleet = snapshot.fleet.filter((item) =>
      item.isRegistered === true && item.vehicle?.status === 'Active'
    );
    const liveVehicles = liveFleet.flatMap((item) => {
      const v = item.vehicle;
      const st = item.storedStatus || {};
      const rawPlans = Array.isArray(st.plans) ? st.plans : [];
      const plans = filterActivePlans(rawPlans, item.status === 'Inside' ? 'Add Plan' : 'Next Trip Plan');
      const latestPlan = plans.length > 0 ? plans[plans.length - 1] : null;

      return item.providerLocations
        .map((location) => {
          const gpsTime = location.providerTimestamp;
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
        vendorName: location.provider,
        provider: location.provider,
        vehicleType: v.fleetType || 'N/A',
        registrationStatus: 'Registered',
        hasGps: location.hasGps,
        latitude: location.latitude,
        longitude: location.longitude,
        speed: location.speed,
        ignition: location.ignition,
        movementStatus: location.movementStatus || st.movementStatus || null,
        dataCheck: false,
        angle: null,
        chargeOn: null,
        timestamp: gpsTime,
        systemSyncTimestamp: location.systemSyncTimestamp,
        readableTime,
        readableLocation: location.latitude !== null && location.longitude !== null &&
          (location.latitude !== 0 || location.longitude !== 0)
          ? getReadableLocation(location.latitude, location.longitude, snapshot.plants)
          : 'N/A',
        gps_status: location.gpsStatus,
        connectionStatus: location.connectionStatus,
        providerUnavailable: location.connectionStatus !== 'Connected'
          ? `${location.provider} unavailable; last known GPS fix ${readableTime || 'time unknown'}`
          : null,
        stayHours: location.stayHours,
        locationDiscrepancyMeters: item.locationDiscrepancyMeters,
        geofence: {
          status: location.status,
          plantName: location.plantName || 'Outside All Plants',
          distanceMeter: location.distanceMeter,
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
    });

    res.json({
      totalCount: liveVehicles.length,
      provider: 'WheelsEye GPS & Fleetx',
      apiUrl: setting ? maskUrlSecret(setting.apiUrl) : '',
      lastSync: snapshot.lastUpdated || setting?.lastSync || null,
      wheelsEyeStatus: {
        connectionStatus: setting?.connectionStatus || 'Pending',
        lastError: setting?.lastError || '',
        lastErrorCode: setting?.lastErrorCode || '',
        lastSuccessAt: setting?.lastSuccessAt || null,
      },
      fleetxStatus: {
        connectionStatus: fleetxSetting?.connectionStatus || 'Pending',
        lastError: fleetxSetting?.lastError || '',
        lastErrorCode: fleetxSetting?.lastErrorCode || '',
        lastSuccessAt: fleetxSetting?.lastSuccessAt || null,
      },
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

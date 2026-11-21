const express = require('express');
const GpsSetting = require('../models/GpsSetting');
const Vehicle = require('../models/Vehicle');
const GpsCredentialAuditLog = require('../models/GpsCredentialAuditLog');
const { verifyToken, checkPageAccess, requireRole } = require('../middleware/auth');
const { testGpsConnection } = require('../services/gpsPollerService');
const { generateFleetReport } = require('../services/reportCalculationService');
const { getFleetGpsSnapshot } = require('../services/gpsDataService');
const { filterActivePlans } = require('../utils/planHelper');
const {
  getGpsConnectionStatus,
  DEFAULT_PROVIDER_URLS,
  isVehicleAssignedToProvider,
} = require('../utils/gpsProvider');

const router = express.Router();

const gpsSyncJobs = new Map();
const GPS_SYNC_JOB_TTL_MS = 30 * 60 * 1000;

const { maskUrlSecret, isSafeExternalUrl } = require('../utils/security');
const { gpsSyncLimiter } = require('../middleware/rateLimiter');
const {
  decryptGpsCredential,
  encryptGpsCredential,
  maskGpsCredential,
} = require('../utils/gpsCredentialCrypto');
const { normalizeVehicleNumber } = require('../services/gpsTimelineService');
const { getMissingRequiredEnvironment } = require('../config/gpsConfig');

function getSafeSyncErrorCode(error) {
  const status = Number(error?.response?.status);
  if (Number.isInteger(status) && status >= 100 && status <= 599) return `HTTP_${status}`;
  const code = String(error?.code || '').toUpperCase();
  if (/^[A-Z0-9_]{2,40}$/.test(code)) return code;
  if (/timeout/i.test(String(error?.message || ''))) return 'REQUEST_TIMEOUT';
  return 'SYNC_FAILED';
}

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
  const envApiKey = (process.env.WHEELSEYE_API_KEY || process.env.WHEELSEYE_ACCESS_TOKEN || '').trim();
  const envUrl = process.env.WHEELSEYE_API_URL || DEFAULT_PROVIDER_URLS.wheelseye;
  const savedCredential = decryptGpsCredential(setting?.encryptedApiKey || '');
  const getUrlToken = (value) => {
    try {
      const url = new URL(value);
      for (const key of ['accessToken', 'access_token', 'apiKey', 'api_key', 'token', 'key', 'secret']) {
        const token = url.searchParams.get(key);
        if (token) return token;
      }
    } catch (_) {}
    return '';
  };
  const envUrlToken = getUrlToken(envUrl);
  const savedUrlToken = getUrlToken(setting?.apiUrl || '');
  return {
    credential: envApiKey || envUrlToken || savedCredential || savedUrlToken,
    source: envApiKey
      ? 'WHEELSEYE_API_KEY / WHEELSEYE_ACCESS_TOKEN'
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

function getGpsSettingQuery() {
  return {
    archived: { $ne: true },
    $or: [{ provider: /wheels.?eye/i }, { apiUrl: /wheelseye/i }],
  };
}

function getProviderConnectionStatus(setting) {
  return getGpsConnectionStatus(setting, 'WheelsEye GPS');
}

// GET /api/gps/vehicle-icon - Retrieve active vehicle icon for map & GPS (Available application-wide)
router.get('/vehicle-icon', async (req, res) => {
  try {
    const setting = await GpsSetting.findOne(getGpsSettingQuery()).sort({ updatedAt: -1 });
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
    const setting = await GpsSetting.findOne(getGpsSettingQuery()).sort({ updatedAt: -1 });
    const effectiveUrl = (process.env.WHEELSEYE_API_URL || '').trim() || getClientApiUrl(setting) || DEFAULT_PROVIDER_URLS.wheelseye;
    const effectiveCredential = getEffectiveGpsCredential(setting);
    res.json({
      _id: setting?._id,
      provider: 'WheelsEye GPS',
      ...(req.user.role === 'Admin' ? { apiUrl: maskUrlSecret(effectiveUrl) } : {}),
      status: 'Active',
      connectionStatus: getProviderConnectionStatus(setting),
      lastSync: setting?.lastSync || null,
      lastSuccessAt: setting?.lastSuccessAt || null,
      lastErrorAt: setting?.lastErrorAt || null,
      lastErrorCode: setting?.lastErrorCode || '',
      lastError: setting?.lastError || '',
      consecutiveFailures: setting?.consecutiveFailures || 0,
      pollIntervalSeconds: setting?.pollIntervalSeconds || 1800,
      ...(req.user.role === 'Admin'
        ? {
            hasApiKey: Boolean(effectiveCredential.credential),
            maskedApiKey: maskGpsCredential(effectiveCredential.credential),
            credentialSource: effectiveCredential.source,
          }
        : {}),
      vehicleIcon: setting?.vehicleIcon || '',
      vehicleIconUpdatedAt: setting?.vehicleIconUpdatedAt || null,
      createdAt: setting?.createdAt,
      updatedAt: setting?.updatedAt,
    });
  } catch (error) {
    const encryptionError = isCredentialEncryptionError(error);
    res.status(encryptionError ? 503 : 500).json({
      error: encryptionError && req.user.role === 'Admin'
        ? 'GPS credential encryption is not configured correctly. Set GPS_CREDENTIAL_ENCRYPTION_KEY to a valid 32-byte key.'
        : 'GPS service temporarily unavailable.',
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
router.post('/', requireRole('Admin'), async (req, res) => {
  try {
    const { apiUrl, apiKey, pollIntervalSeconds } = req.body;

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
      status: 'Active',
      pollIntervalSeconds: Number(pollIntervalSeconds) || 1800, // 30 Min mandatory
      connectionStatus: 'Pending',
      last_sync_status: 'IDLE',
      lastError: '',
    };

    let urlCredential = '';
    const changedFields = [];
    if (apiUrl && !apiUrl.includes('••••')) {
      const parsedUrl = new URL(apiUrl.trim());
      for (const key of ['accessToken', 'access_token', 'apiKey', 'api_key', 'token', 'key', 'secret']) {
        if (parsedUrl.searchParams.has(key)) {
          urlCredential = parsedUrl.searchParams.get(key) || '';
          parsedUrl.searchParams.delete(key);
        }
      }
      updateData.apiUrl = parsedUrl.toString();
      changedFields.push('apiUrl');
    }
    if (apiKey && !apiKey.includes('••••')) {
      updateData.encryptedApiKey = encryptGpsCredential(apiKey.trim());
      changedFields.push('apiCredential');
    } else if (urlCredential) {
      updateData.encryptedApiKey = encryptGpsCredential(urlCredential);
      changedFields.push('apiCredential');
    }
    if (setting) {
      Object.assign(setting, updateData);
      await setting.save();
    } else {
      setting = await GpsSetting.create(updateData);
    }
    if (changedFields.length > 0) {
      try {
        await GpsCredentialAuditLog.create({
          provider: providerClean,
          changedFields: [...new Set(changedFields)],
          changedBy: req.user._id,
        });
      } catch (auditError) {
        console.error('[GPS Credential Audit Error]:', auditError.message);
        return res.status(500).json({
          error: 'GPS configuration was updated, but its audit record could not be saved.',
        });
      }
    }

    const effectiveCredential = getEffectiveGpsCredential(setting);
    res.json({
      message: `${providerClean} configuration saved successfully.`,
      setting: {
        _id: setting._id,
        provider: setting.provider,
        apiUrl: maskUrlSecret(
          process.env.WHEELSEYE_API_URL?.trim() ||
          getClientApiUrl(setting) ||
          DEFAULT_PROVIDER_URLS.wheelseye
        ),
        status: 'Active',
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
router.post('/test-connection', gpsSyncLimiter, requireRole('Admin'), async (req, res) => {
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

// GET /api/gps/telematics-overview - Separate WheelsEye and FleetX GPS Telematics data
router.get('/telematics-overview', async (req, res) => {
  try {
    const { getProviderTelematicsOverview } = require('../services/gpsSyncEngine');
    const overview = await getProviderTelematicsOverview();
    res.json(overview);
  } catch (error) {
    console.error('[GPS Telematics Overview Error]:', error);
    res.status(500).json({ error: 'Failed to retrieve GPS telematics overview.' });
  }
});

// GET /api/gps/fleetx/history - FleetX provider history for a selected vehicle and time range
router.get('/fleetx/history', async (req, res) => {
  try {
    const Vehicle = require('../models/Vehicle');
    const { fetchFleetxHistory } = require('../services/fleetxService');
    const vehicleId = String(req.query.vehicleId || '').trim();
    const vehicleNumber = String(req.query.vehicleNumber || '').trim();
    const from = Number(req.query.from);
    const to = Number(req.query.to);

    let providerVehicleId = vehicleId;
    if (!providerVehicleId && vehicleNumber) {
      const normalized = normalizeVehicleNumber(vehicleNumber);
      const vehicle = (await Vehicle.find()).find(
        (item) => normalizeVehicleNumber(item.vehicleNumber) === normalized
      );
      providerVehicleId = vehicle?.fleetxVehicleId || '';
    }
    if (!providerVehicleId) {
      return res.status(400).json({ error: 'A mapped FleetX vehicle ID is required.' });
    }

    const data = await fetchFleetxHistory({ vehicleId: providerVehicleId, from, to });
    res.json({ success: true, vehicleId: providerVehicleId, data });
  } catch (error) {
    console.error('[FleetX History Error]:', getSafeSyncErrorCode(error));
    res.status(error.message?.includes('required') ? 400 : 502).json({
      success: false,
      error: error.message?.includes('required') ? 'FleetX history parameters are required.' : 'Failed to retrieve FleetX history.',
      errorCode: getSafeSyncErrorCode(error),
    });
  }
});

// GET /api/gps/sync-job/:jobId - Provider-wise background synchronization status
router.get('/sync-job/:jobId', async (req, res) => {
  const job = gpsSyncJobs.get(String(req.params.jobId || '').trim());
  if (!job) {
    return res.status(404).json({ success: false, error: 'GPS synchronization job not found or expired.' });
  }
  return res.json(job);
});

// POST /api/gps/sync/:provider - Manual synchronization for a specific GPS provider
router.post('/sync/:provider', gpsSyncLimiter, requireRole('Admin'), async (req, res) => {
  try {
    const { provider } = req.params;
    const { syncProviderGps } = require('../services/gpsSyncEngine');
    const normalizedProvider = /^(all|both)$/i.test(provider)
      ? 'ALL'
      : /^fleetx$/i.test(provider)
        ? 'FLEETX'
        : /^wheels/i.test(provider)
          ? 'WHEELSEYE'
          : '';
    if (!normalizedProvider) {
      return res.status(400).json({ error: 'Provider must be WheelsEye, FleetX, or All.' });
    }

    const conflictingJob = [...gpsSyncJobs.values()].find((existingJob) =>
      existingJob.status === 'RUNNING' &&
      (
        existingJob.provider === 'ALL' ||
        normalizedProvider === 'ALL' ||
        existingJob.provider === normalizedProvider
      )
    );
    if (conflictingJob) {
      return res.status(202).json({
        success: true,
        jobId: conflictingJob.jobId,
        status: 'RUNNING',
        message: 'A matching GPS synchronization is already in progress.',
      });
    }

    const jobId = `gps_sync_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const job = {
      jobId,
      status: 'RUNNING',
      startedAt: new Date().toISOString(),
      completedAt: null,
      provider: normalizedProvider,
      wheelseye: { status: 'PENDING' },
      fleetx: { status: 'PENDING' },
    };
    gpsSyncJobs.set(jobId, job);

    setImmediate(async () => {
      try {
        if (normalizedProvider === 'ALL') {
          const [wheelseye, fleetx] = await Promise.allSettled([
            syncProviderGps({ provider: 'WHEELSEYE', mode: 'MANUAL', caller: req.user?.username || 'Admin' }),
            syncProviderGps({ provider: 'FLEETX', mode: 'MANUAL', caller: req.user?.username || 'Admin' }),
          ]);
          job.wheelseye = wheelseye.status === 'fulfilled'
            ? { ...wheelseye.value, status: wheelseye.value.status || (wheelseye.value.success ? 'SUCCESS' : 'FAILED') }
            : { status: 'FAILED', success: false, errorCode: getSafeSyncErrorCode(wheelseye.reason) };
          job.fleetx = fleetx.status === 'fulfilled'
            ? { ...fleetx.value, status: fleetx.value.status || (fleetx.value.success ? 'SUCCESS' : 'FAILED') }
            : { status: 'FAILED', success: false, errorCode: getSafeSyncErrorCode(fleetx.reason) };
          job.success = Boolean(job.wheelseye.success || job.fleetx.success);
        } else {
          const result = await syncProviderGps({
            provider: normalizedProvider,
            mode: 'MANUAL',
            caller: req.user?.username || 'Admin',
          });
          const providerKey = normalizedProvider === 'FLEETX' ? 'fleetx' : 'wheelseye';
          job[providerKey] = { ...result, status: result.status || (result.success ? 'SUCCESS' : 'FAILED') };
          job.success = Boolean(result.success);
        }
        job.status = 'COMPLETED';
      } catch (error) {
        job.status = 'FAILED';
        job.errorCode = getSafeSyncErrorCode(error);
      } finally {
        job.completedAt = new Date().toISOString();
        setTimeout(() => gpsSyncJobs.delete(jobId), GPS_SYNC_JOB_TTL_MS);
      }
    });

    return res.status(202).json({
      success: true,
      jobId,
      status: 'RUNNING',
      message: 'GPS synchronization started. Poll the synchronization status for provider results.',
    });
  } catch (error) {
    console.error('[Provider Sync Error]:', getSafeSyncErrorCode(error));
    res.status(502).json({
      error: 'Provider GPS synchronization failed.',
      errorCode: getSafeSyncErrorCode(error),
    });
  }
});

// POST /api/gps/trigger-sync - On-demand GPS sync trigger
router.post('/trigger-sync', gpsSyncLimiter, requireRole('Admin'), async (req, res) => {
  try {
    const { syncBothGpsProviders } = require('../services/gpsSyncEngine');
    const result = await syncBothGpsProviders({
      mode: 'MANUAL',
      caller: req.user?.username || 'Admin',
    });
    const success = Boolean(result.wheelseye.success || result.fleetx.success);
    res.status(success ? 200 : 502).json({
      success,
      message: 'Independent GPS synchronization completed.',
      ...result,
    });
  } catch (error) {
    console.error('[Trigger GPS Sync Error]:', getSafeSyncErrorCode(error));
    res.status(502).json({
      error: 'GPS synchronization failed.',
      errorCode: getSafeSyncErrorCode(error),
    });
  }
});

// GET /api/gps/live-vehicles - Live vehicle stream from verified GPS Single Source of Truth
router.get('/live-vehicles', async (req, res) => {
  try {
    const { getReadableLocation } = require('../services/locationHelper');

    const [wheelsEyeSetting, fleetxSetting, registeredVehicles] = await Promise.all([
      GpsSetting.findOne(getGpsSettingQuery()).sort({ updatedAt: -1 }),
      GpsSetting.findOne({
        archived: { $ne: true },
        $or: [{ provider: /fleetx/i }, { apiUrl: /fleetx/i }],
      }).sort({ updatedAt: -1 }),
      Vehicle.find({ status: 'Active' }).select('_id gps_provider gpsProvider gpsProviders').lean(),
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
        deviceNumber: location.deviceNumber || v.gpsDeviceId || 'N/A',
        vendorName: location.provider,
        provider: location.provider,
        vehicleType: v.fleetType || 'N/A',
        registrationStatus: 'Registered',
        hasGps: location.hasGps,
        latitude: location.latitude,
        longitude: location.longitude,
        speed: location.speed,
        ignition: location.ignition,
        movementStatus: location.movementStatus || null,
        dataCheck: false,
        angle: location.angle,
        chargeOn: null,
        timestamp: gpsTime,
        systemSyncTimestamp: location.systemSyncTimestamp,
        readableTime,
        readableLocation: location.latitude !== null && location.longitude !== null &&
          (location.latitude !== 0 || location.longitude !== 0)
          ? location.address || getReadableLocation(location.latitude, location.longitude, snapshot.plants)
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
    const getProviderCounts = (provider) => {
      const assignedVehicles = registeredVehicles.filter((vehicle) =>
        isVehicleAssignedToProvider(vehicle, provider)
      );
      const assignedIds = new Set(assignedVehicles.map((vehicle) => vehicle._id.toString()));
      const locatedVehicleIds = new Set(liveVehicles
        .filter((vehicle) =>
          assignedIds.has(vehicle.vehicleId.toString()) &&
          (provider === 'FLEETX'
            ? /fleetx/i.test(vehicle.provider)
            : /wheels.?eye/i.test(vehicle.provider)) &&
          vehicle.hasGps &&
          Number.isFinite(vehicle.latitude) &&
          Number.isFinite(vehicle.longitude)
        )
        .map((vehicle) => vehicle.vehicleId.toString()));
      return {
        registeredVehicleCount: assignedVehicles.length,
        validGpsVehicleCount: locatedVehicleIds.size,
      };
    };
    const fleetxCredentialsConfigured = Boolean(
      (process.env.FLEETX_BASIC_AUTH || '').trim() &&
      (process.env.FLEETX_USERNAME || '').trim() &&
      (process.env.FLEETX_PASSWORD || '').trim()
    );
    const fleetxConnectionStatus = fleetxCredentialsConfigured
      ? getGpsConnectionStatus(fleetxSetting, 'FleetX')
      : 'Disconnected';
    res.json({
      totalCount: liveVehicles.length,
      provider: 'WheelsEye GPS',
      lastSync: snapshot.lastUpdated || null,
      missingEnvironment: getMissingRequiredEnvironment(),
      wheelsEyeStatus: {
        connectionStatus: getProviderConnectionStatus(wheelsEyeSetting),
        lastSyncStatus: wheelsEyeSetting?.last_sync_status || 'IDLE',
        lastError: wheelsEyeSetting?.lastError || '',
        lastErrorCode: wheelsEyeSetting?.lastErrorCode || '',
        lastSuccessAt: wheelsEyeSetting?.lastSuccessAt || null,
        ...getProviderCounts('WHEELSEYE'),
      },
      fleetxStatus: {
        connectionStatus: fleetxConnectionStatus,
        lastSyncStatus: fleetxSetting?.last_sync_status || 'IDLE',
        lastError: fleetxSetting?.lastError || '',
        lastErrorCode: fleetxSetting?.lastErrorCode || '',
        lastSuccessAt: fleetxSetting?.lastSuccessAt || null,
        ...getProviderCounts('FLEETX'),
      },
      vehicles: liveVehicles,
    });
  } catch (error) {
    console.error('[Live Vehicles Error]:', getSafeSyncErrorCode(error));
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

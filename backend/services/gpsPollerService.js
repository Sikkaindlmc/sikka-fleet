const GpsSetting = require('../models/GpsSetting');
const {
  executeGpsSync,
  DEFAULT_WHEELSEYE_URL,
  DEFAULT_FLEETX_URL,
  DEFAULT_FLEETX_TOKEN,
  fetchWheelseyeTelemetryWithRetries,
  fetchFleetxTelemetryWithRetries,
} = require('./gpsSyncService');
const { isSafeExternalUrl } = require('../utils/security');
const axios = require('axios');

async function syncGpsPositions(syncType = 'Auto Sync') {
  const isAuto = syncType.toLowerCase().includes('auto') || syncType.toLowerCase().includes('cron');
  return await executeGpsSync({
    source: isAuto ? 'AUTO' : 'MANUAL',
    triggerType: syncType,
  });
}

async function testGpsConnection(targetProvider = null) {
  try {
    const settings = await GpsSetting.find();
    const providerLower = (targetProvider || '').toLowerCase();

    // If testing Fleetx specifically
    if (providerLower.includes('fleetx')) {
      const fxConfig = settings.find((s) => s.provider && s.provider.toLowerCase().includes('fleetx'));
      const apiUrl = fxConfig?.apiUrl || DEFAULT_FLEETX_URL;
      const token = fxConfig?.encryptedApiKey || DEFAULT_FLEETX_TOKEN;

      const res = await fetchFleetxTelemetryWithRetries(apiUrl, token, 1);
      const count = res.list ? res.list.length : 0;

      await GpsSetting.findOneAndUpdate(
        { $or: [{ provider: /fleetx/i }, { apiUrl: /fleetx/i }] },
        {
          $set: {
            provider: 'Fleetx',
            apiUrl,
            encryptedApiKey: token,
            connectionStatus: 'Connected',
            lastSync: new Date(),
            lastError: '',
          },
        },
        { upsert: true }
      );

      return {
        status: 'Connected',
        provider: 'Fleetx',
        message: `Successfully connected to Fleetx GPS. Received telemetry for ${count} vehicles.`,
        lastSync: new Date(),
        count,
      };
    }

    // If testing WheelsEye specifically
    if (providerLower.includes('wheels')) {
      const weConfig = settings.find((s) => s.provider && s.provider.toLowerCase().includes('wheels'));
      const apiUrl = weConfig?.apiUrl || DEFAULT_WHEELSEYE_URL;

      const res = await fetchWheelseyeTelemetryWithRetries(apiUrl, 1);
      const count = res.list ? res.list.length : 0;

      await GpsSetting.findOneAndUpdate(
        { $or: [{ provider: /wheels/i }, { apiUrl: /wheelseye/i }] },
        {
          $set: {
            provider: 'WheelsEye GPS',
            apiUrl,
            connectionStatus: 'Connected',
            lastSync: new Date(),
            lastError: '',
          },
        },
        { upsert: true }
      );

      return {
        status: 'Connected',
        provider: 'WheelsEye GPS',
        message: `Successfully connected to WheelsEye GPS. Received telemetry for ${count} vehicles.`,
        lastSync: new Date(),
        count,
      };
    }

    // Default: Test both WheelsEye and Fleetx
    const results = [];
    const weConfig = settings.find((s) => s.provider && s.provider.toLowerCase().includes('wheels'));
    const weUrl = weConfig?.apiUrl || DEFAULT_WHEELSEYE_URL;

    try {
      const weRes = await fetchWheelseyeTelemetryWithRetries(weUrl, 1);
      results.push(`WheelsEye: ${weRes.list.length} vehicles`);
      await GpsSetting.findOneAndUpdate(
        { $or: [{ provider: /wheels/i }, { apiUrl: /wheelseye/i }] },
        { $set: { connectionStatus: 'Connected', lastSync: new Date(), lastError: '' } }
      );
    } catch (weErr) {
      results.push(`WheelsEye: Failed (${weErr.message})`);
    }

    const fxConfig = settings.find((s) => s.provider && s.provider.toLowerCase().includes('fleetx'));
    const fxUrl = fxConfig?.apiUrl || DEFAULT_FLEETX_URL;
    const fxToken = fxConfig?.encryptedApiKey || DEFAULT_FLEETX_TOKEN;

    try {
      const fxRes = await fetchFleetxTelemetryWithRetries(fxUrl, fxToken, 1);
      results.push(`Fleetx: ${fxRes.list.length} vehicles`);
      await GpsSetting.findOneAndUpdate(
        { $or: [{ provider: /fleetx/i }, { apiUrl: /fleetx/i }] },
        { $set: { connectionStatus: 'Connected', lastSync: new Date(), lastError: '' } },
        { upsert: true }
      );
    } catch (fxErr) {
      results.push(`Fleetx: Failed (${fxErr.message})`);
    }

    return {
      status: 'Connected',
      provider: 'Multi-Provider (WheelsEye & Fleetx)',
      message: `Connection test completed: ${results.join('; ')}`,
      lastSync: new Date(),
    };
  } catch (error) {
    return {
      status: 'Connection Failed',
      message: error.message || 'Unable to connect to GPS provider.',
      lastError: error.message,
    };
  }
}

function startGpsPoller() {
  // Handled by gpsScheduler
}

function stopGpsPoller() {
  // Handled by gpsScheduler
}

module.exports = {
  syncGpsPositions,
  testGpsConnection,
  startGpsPoller,
  stopGpsPoller,
};

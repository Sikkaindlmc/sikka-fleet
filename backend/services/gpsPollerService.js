const GpsSetting = require('../models/GpsSetting');
const {
  executeGpsSync,
  DEFAULT_WHEELSEYE_URL,
  fetchWheelseyeTelemetryWithRetries,
} = require('./gpsSyncService');
const { decryptGpsCredential } = require('../utils/gpsCredentialCrypto');

async function syncGpsPositions(syncType = 'Auto Sync') {
  const isAuto = syncType.toLowerCase().includes('auto') || syncType.toLowerCase().includes('cron');
  return await executeGpsSync({
    source: isAuto ? 'AUTO' : 'GPS-AUTO',
    triggerType: syncType,
  });
}

async function testGpsConnection() {
  const provider = 'WheelsEye GPS';
  const settingQuery = {
    archived: { $ne: true },
    $or: [{ provider: /wheels/i }, { apiUrl: /wheelseye/i }],
  };
  const setting = await GpsSetting.findOne(settingQuery);
  const apiUrl = (process.env.WHEELSEYE_API_URL || '').trim() || setting?.apiUrl || DEFAULT_WHEELSEYE_URL;
  const envToken = (process.env.WHEELSEYE_API_KEY || process.env.WHEELSEYE_ACCESS_TOKEN || '').trim();
  let urlToken = '';
  try {
    const parsedUrl = new URL(apiUrl);
    for (const key of ['accessToken', 'access_token', 'apiKey', 'api_key', 'token', 'key', 'secret']) {
      urlToken = parsedUrl.searchParams.get(key) || '';
      if (urlToken) break;
    }
  } catch (_) {
    // The request service returns the user-facing URL validation failure.
  }
  const savedToken = decryptGpsCredential(setting?.encryptedApiKey || '').trim();
  const token = envToken || urlToken || savedToken;
  const credentialSource = envToken
    ? 'WHEELSEYE_API_KEY or WHEELSEYE_ACCESS_TOKEN'
    : urlToken && process.env.WHEELSEYE_API_URL?.trim()
      ? 'WHEELSEYE_API_URL query'
      : urlToken
        ? 'GPS settings URL query'
    : token
      ? 'GPS settings'
      : 'none';
  const now = new Date();

  try {
    const response = await fetchWheelseyeTelemetryWithRetries(apiUrl, 1, token);
    const count = response.list.length;
    await GpsSetting.findOneAndUpdate(settingQuery, {
      $set: {
        provider,
        connectionStatus: 'Connected',
        lastSync: now,
        lastSuccessAt: now,
        lastCredentialSource: credentialSource,
        lastError: '',
        consecutiveFailures: 0,
      },
    }, { upsert: true });

    return {
      status: 'Connected',
      provider,
      httpStatus: Number(String(response.status).split(' ')[0]) || 200,
      credentialSource,
      message: `${provider} connection OK using ${credentialSource}. Received telemetry for ${count} vehicles.`,
      lastSync: now,
      count,
    };
  } catch (error) {
    const httpStatus = error.response?.status || null;
    const reason = httpStatus ? `HTTP ${httpStatus}` : error.code === 'ECONNABORTED' ? 'Request timed out' : 'WheelsEye request failed';
    const nextStep = httpStatus === 401 || httpStatus === 403
      ? 'Verify this credential is active and confirm the endpoint and auth scheme with the provider documentation.'
      : 'Verify the WheelsEye URL and credentials in GPS settings or the server environment.';
    await GpsSetting.findOneAndUpdate(settingQuery, {
      $set: {
        provider,
        connectionStatus: httpStatus === 401 || httpStatus === 403 ? 'AUTH_FAILED' : 'Connection Failed',
        lastError: reason,
        lastErrorAt: now,
        lastErrorCode: httpStatus ? String(httpStatus) : error.code || 'REQUEST_FAILED',
        lastCredentialSource: credentialSource,
      },
      $inc: { consecutiveFailures: 1 },
    }, { upsert: true });

    return {
      status: 'Connection Failed',
      provider,
      httpStatus,
      credentialSource,
      message: `${provider} connection failed using ${credentialSource}: ${reason}. ${nextStep}`,
      reason,
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

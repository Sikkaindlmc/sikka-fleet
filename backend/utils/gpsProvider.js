const WHEELSEYE = 'wheelseye';
const FLEETX = 'fleetx';
const DEFAULT_PROVIDER_URLS = {
  [WHEELSEYE]: 'https://api.wheelseye.com/currentLoc',
  [FLEETX]: 'https://api.fleetx.io',
};

function normalizeGpsProvider(value, fallback = WHEELSEYE) {
  const normalized = String(value || '').toLowerCase().replace(/[^a-z]/g, '');
  if (normalized.includes('wheels')) return WHEELSEYE;
  if (normalized.includes('fleet')) return FLEETX;
  if (!normalized && fallback) return normalizeGpsProvider(fallback, '');
  return '';
}

function getAssignedGpsProvider(vehicle) {
  const provider = String(vehicle?.gps_provider || vehicle?.gpsProvider || '').toLowerCase();
  return provider.includes('fleet') ? FLEETX : WHEELSEYE;
}

function isVehicleAssignedToProvider(vehicle, provider) {
  const expected = normalizeGpsProvider(provider, '');
  if (!expected) return false;

  const primary = String(vehicle?.gps_provider || vehicle?.gpsProvider || '').trim();
  if (/^both$/i.test(primary)) return true;
  const normalizedPrimary = normalizeGpsProvider(primary, '');
  if (normalizedPrimary) return normalizedPrimary === expected;

  const configuredProviders = Array.isArray(vehicle?.gpsProviders) ? vehicle.gpsProviders : [];
  if (configuredProviders.length) {
    return configuredProviders.some((entry) => normalizeGpsProvider(entry, '') === expected);
  }
  return expected === WHEELSEYE;
}

function getGpsConnectionStatus(setting, provider, now = Date.now()) {
  const startedAt = setting?.lastSync ? new Date(setting.lastSync).getTime() : NaN;
  if (setting?.last_sync_status === 'RUNNING') {
    return Number.isFinite(startedAt) && now - startedAt <= 10 * 60 * 1000
      ? 'Syncing'
      : 'Disconnected';
  }

  const lastSuccess = setting?.lastSuccessAt
    ? new Date(setting.lastSuccessAt).getTime()
    : setting?.connectionStatus === 'Connected'
      ? new Date(setting.lastConnectionCheckAt || setting.lastSync || 0).getTime()
    : setting?.last_sync_status === 'SUCCESS' || setting?.last_sync_status === 'PARTIAL'
      ? new Date(setting.lastSync || setting.lastConnectionCheckAt || 0).getTime()
      : NaN;
  const lastError = setting?.lastErrorAt ? new Date(setting.lastErrorAt).getTime() : NaN;
  if (
    setting?.connectionStatus === 'AUTH_FAILED' ||
    setting?.last_sync_status === 'FAILED' ||
    setting?.connectionStatus === 'Connection Failed' && (!Number.isFinite(lastSuccess) || lastError >= lastSuccess)
  ) {
    return 'Sync Failed';
  }

  if (
    Number.isFinite(lastSuccess) &&
    lastSuccess <= now &&
    now - lastSuccess <= 60 * 60 * 1000 &&
    (!Number.isFinite(lastError) || lastSuccess > lastError)
  ) {
    return 'Connected';
  }

  return 'Disconnected';
}

module.exports = {
  WHEELSEYE,
  FLEETX,
  DEFAULT_PROVIDER_URLS,
  normalizeGpsProvider,
  getAssignedGpsProvider,
  isVehicleAssignedToProvider,
  getGpsConnectionStatus,
};

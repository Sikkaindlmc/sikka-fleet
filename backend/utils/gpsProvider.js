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

function getGpsConnectionStatus(setting, provider, now = Date.now()) {
  if (setting?.connectionStatus === 'AUTH_FAILED') return 'AUTH_FAILED';
  if (setting?.connectionStatus === 'Connection Failed' && setting?.lastErrorAt) {
    return 'Connection Failed';
  }

  if (setting?.connectionStatus === 'Connected') {
    const lastCheck = setting.lastConnectionCheckAt || setting.lastSuccessAt || setting.lastSync;
    const checkedAt = lastCheck ? new Date(lastCheck).getTime() : NaN;
    if (Number.isFinite(checkedAt)) {
      return now - checkedAt <= 60 * 60 * 1000 ? 'Connected' : 'Disconnected';
    }
  }

  const normalizedProvider = normalizeGpsProvider(provider);
  const configuredUrl = normalizedProvider === FLEETX
    ? process.env.FLEETX_API_BASE_URL || setting?.apiUrl || DEFAULT_PROVIDER_URLS[FLEETX]
    : process.env.WHEELSEYE_API_URL || setting?.apiUrl || DEFAULT_PROVIDER_URLS[WHEELSEYE];
  return configuredUrl ? 'Pending' : 'Configuration Missing';
}

module.exports = {
  WHEELSEYE,
  FLEETX,
  DEFAULT_PROVIDER_URLS,
  normalizeGpsProvider,
  getAssignedGpsProvider,
  getGpsConnectionStatus,
};

const WHEELSEYE = 'wheelseye';
const FLEETX = 'fleetx';

function normalizeGpsProvider(value, fallback = WHEELSEYE) {
  const normalized = String(value || '').toLowerCase().replace(/[^a-z]/g, '');
  if (normalized.includes('fleetx') || normalized === 'fleet') return FLEETX;
  if (normalized.includes('wheels')) return WHEELSEYE;
  if (!normalized && fallback) return normalizeGpsProvider(fallback, '');
  return '';
}

function getAssignedGpsProvider(vehicle) {
  const explicitProvider = normalizeGpsProvider(vehicle?.gpsProvider, '');
  if (explicitProvider) return explicitProvider;

  const observedProviders = (Array.isArray(vehicle?.gpsProviders) ? vehicle.gpsProviders : [])
    .map((provider) => normalizeGpsProvider(provider, ''))
    .filter(Boolean);
  if (observedProviders.includes(FLEETX) && !observedProviders.includes(WHEELSEYE)) {
    return FLEETX;
  }
  return WHEELSEYE;
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

  const providerName = normalizeGpsProvider(provider, '');
  const configuredUrl = providerName === FLEETX
    ? process.env.FLEETX_API_URL || setting?.apiUrl
    : process.env.WHEELSEYE_API_URL || setting?.apiUrl;
  return configuredUrl ? 'Pending' : 'Configuration Missing';
}

module.exports = {
  WHEELSEYE,
  FLEETX,
  normalizeGpsProvider,
  getAssignedGpsProvider,
  getGpsConnectionStatus,
};

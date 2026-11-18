const WHEELSEYE = 'wheelseye';
const DEFAULT_PROVIDER_URLS = {
  [WHEELSEYE]: 'https://api.wheelseye.com/currentLoc',
};

function normalizeGpsProvider(value, fallback = WHEELSEYE) {
  const normalized = String(value || '').toLowerCase().replace(/[^a-z]/g, '');
  if (normalized.includes('wheels')) return WHEELSEYE;
  if (!normalized && fallback) return normalizeGpsProvider(fallback, '');
  return '';
}

function getAssignedGpsProvider() {
  return WHEELSEYE;
}

function getGpsConnectionStatus(setting, _provider, now = Date.now()) {
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

  const configuredUrl = process.env.WHEELSEYE_API_URL || setting?.apiUrl || DEFAULT_PROVIDER_URLS[WHEELSEYE];
  return configuredUrl ? 'Pending' : 'Configuration Missing';
}

module.exports = {
  WHEELSEYE,
  DEFAULT_PROVIDER_URLS,
  normalizeGpsProvider,
  getAssignedGpsProvider,
  getGpsConnectionStatus,
};

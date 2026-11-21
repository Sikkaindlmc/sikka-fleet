const { isSafeExternalUrl } = require('../utils/security');
const { DEFAULT_PROVIDER_URLS } = require('../utils/gpsProvider');

function validateGpsUrl(name, value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return { name, configured: false, message: `${name} is not configured.` };
  }

  try {
    const url = new URL(trimmed);
    const safe = isSafeExternalUrl(url.toString());
    if (!safe) {
      return { name, configured: false, message: `${name} must use a secure public HTTP/HTTPS URL.` };
    }
    return { name, configured: true, message: `${name} is valid.` };
  } catch (error) {
    return { name, configured: false, message: `${name} is not a valid URL.` };
  }
}

function validateGpsEnvironment() {
  const checks = [
    validateGpsUrl('WHEELSEYE_API_URL', process.env.WHEELSEYE_API_URL || DEFAULT_PROVIDER_URLS.wheelseye),
    validateGpsUrl('FLEETX_API_BASE_URL', process.env.FLEETX_API_BASE_URL || DEFAULT_PROVIDER_URLS.fleetx),
  ];

  const fleetxUsernameConfigured = Boolean(String(process.env.FLEETX_USERNAME || '').trim());
  const fleetxPasswordConfigured = Boolean(String(process.env.FLEETX_PASSWORD || '').trim());
  const fleetxBasicAuthConfigured = Boolean(String(process.env.FLEETX_BASIC_AUTH || '').trim());
  checks.push({
    name: 'FLEETX_CREDENTIALS',
    configured: fleetxUsernameConfigured && fleetxPasswordConfigured && fleetxBasicAuthConfigured,
    message: fleetxUsernameConfigured && fleetxPasswordConfigured && fleetxBasicAuthConfigured
      ? 'FLEETX_CREDENTIALS are configured.'
      : 'FleetX credentials are incomplete. Set FLEETX_USERNAME, FLEETX_PASSWORD, and FLEETX_BASIC_AUTH.',
  });

  const invalid = checks.filter((item) => !item.configured);
  if (invalid.length > 0) {
    for (const item of invalid) {
      console.warn(`[GPS Config] ${item.message}`);
    }
  }

  return {
    valid: invalid.length === 0,
    checks,
  };
}

module.exports = {
  validateGpsUrl,
  validateGpsEnvironment,
};

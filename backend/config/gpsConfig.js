const { isSafeExternalUrl } = require('../utils/security');
const { DEFAULT_PROVIDER_URLS } = require('../utils/gpsProvider');

function getMissingRequiredEnvironment() {
  const missing = [];
  if (![process.env.MONGODB_URI, process.env.MONGO_URI, process.env.MONGODB_DIRECT_URI]
    .some((value) => String(value || '').trim())) {
    missing.push('MONGODB_URI');
  }
  if (!String(process.env.JWT_SECRET || '').trim()) missing.push('JWT_SECRET');
  if (!String(process.env.CRON_SECRET || '').trim()) missing.push('CRON_SECRET');
  if (![process.env.WHEELSEYE_ACCESS_TOKEN, process.env.WHEELSEYE_API_KEY]
    .some((value) => String(value || '').trim())) {
    missing.push('WHEELSEYE_ACCESS_TOKEN');
  }
  if (!String(process.env.FLEETX_USERNAME || '').trim()) missing.push('FLEETX_USERNAME');
  if (!String(process.env.FLEETX_PASSWORD || '').trim()) missing.push('FLEETX_PASSWORD');
  if (!String(process.env.FLEETX_BASIC_AUTH || '').trim()) missing.push('FLEETX_BASIC_AUTH');
  return missing;
}

function getMissingProviderEnvironment(provider) {
  const missing = [];
  if (provider === 'FLEETX') {
    if (!String(process.env.FLEETX_USERNAME || '').trim()) missing.push('FLEETX_USERNAME');
    if (!String(process.env.FLEETX_PASSWORD || '').trim()) missing.push('FLEETX_PASSWORD');
    if (!String(process.env.FLEETX_BASIC_AUTH || '').trim()) missing.push('FLEETX_BASIC_AUTH');
  } else if (![process.env.WHEELSEYE_ACCESS_TOKEN, process.env.WHEELSEYE_API_KEY]
    .some((value) => String(value || '').trim())) {
    missing.push('WHEELSEYE_ACCESS_TOKEN');
  }
  return missing;
}

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
  for (const name of getMissingRequiredEnvironment()) {
    console.warn(`MISSING ENV: ${name}`);
  }

  const checks = [
    validateGpsUrl(
      'WHEELSEYE_API_URL',
      String(process.env.WHEELSEYE_API_URL || '').trim() || DEFAULT_PROVIDER_URLS.wheelseye
    ),
    validateGpsUrl(
      'FLEETX_API_BASE_URL',
      [process.env.FLEETX_API_BASE_URL, process.env.FLEETX_BASE_URL]
        .map((value) => String(value || '').trim())
        .find(Boolean) || DEFAULT_PROVIDER_URLS.fleetx
    ),
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
  getMissingRequiredEnvironment,
  getMissingProviderEnvironment,
  validateGpsUrl,
  validateGpsEnvironment,
};

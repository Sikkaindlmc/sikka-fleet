const { isSafeExternalUrl } = require('../utils/security');

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
    validateGpsUrl('WHEELSEYE_API_URL', process.env.WHEELSEYE_API_URL),
    validateGpsUrl('FLEETX_API_URL', process.env.FLEETX_API_URL),
    validateGpsUrl('FLEETX_LOGIN_URL', process.env.FLEETX_LOGIN_URL),
    validateGpsUrl('FLEETX_VEHICLE_URL', process.env.FLEETX_VEHICLE_URL),
  ];

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

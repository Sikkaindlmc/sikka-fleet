/**
 * Sikka Fleet Rate Limiting Configuration
 *
 * UNRESTRICTED MULTI-NETWORK ACCESS:
 * All IP-based throttling limits are removed so that multiple users and drivers
 * connecting from the same Office Wi-Fi, Mobile Hotspot, 4G/5G Carrier CGNAT,
 * Public Wi-Fi, or Home Wi-Fi are NEVER throttled or blocked by IP address.
 */

// Passthrough middleware - no IP restriction, no request limit
const authLimiter = (req, res, next) => next();

const gpsSyncLimiter = (req, res, next) => next();

const generalApiLimiter = (req, res, next) => next();

module.exports = {
  authLimiter,
  gpsSyncLimiter,
  generalApiLimiter,
};

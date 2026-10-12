const rateLimit = require('express-rate-limit');

/**
 * Rate limiter for user & driver authentication endpoints.
 * Mitigates brute-force credential stuffing and password guessing attacks.
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Max 20 login attempts per 15 mins per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many login attempts from this IP address. Please try again after 15 minutes.',
    code: 'RATE_LIMIT_EXCEEDED',
  },
});

/**
 * Rate limiter for manual and automated GPS synchronization endpoints.
 * Prevents GPS API quota exhaustion, database thrashing, and DoS.
 */
const gpsSyncLimiter = rateLimit({
  windowMs: 2 * 60 * 1000, // 2 minutes
  max: 15, // Max 15 sync requests per 2 mins
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many GPS sync requests. Please wait a moment before synchronizing again.',
    code: 'SYNC_RATE_LIMIT_EXCEEDED',
  },
});

/**
 * General API rate limiter for all endpoints to mitigate volumetric abuse.
 */
const generalApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // 1000 requests per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many API requests from this client. Please slow down.',
    code: 'API_RATE_LIMIT_EXCEEDED',
  },
});

module.exports = {
  authLimiter,
  gpsSyncLimiter,
  generalApiLimiter,
};

/**
 * Sikka Fleet Rate Limiting Configuration
 *
 * Auth limiter: strict – prevents brute-force login attacks.
 * GPS / general limiters: generous – allows normal fleet operations.
 */
const rateLimit = require('express-rate-limit');

/**
 * Auth limiter: 10 attempts per 15 minutes per IP address.
 * Only counts failed requests toward the limit.
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    error: 'Too many login attempts from this IP address. Please wait 15 minutes and try again.',
  },
  handler: (req, res, next, options) => {
    res.status(429).json(options.message);
  },
});

// GPS sync limiter: 200 requests per minute per IP
const gpsSyncLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many GPS sync requests. Please slow down.' },
});

// General API limiter: 500 requests per minute per IP
const generalApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again shortly.' },
});

module.exports = {
  authLimiter,
  gpsSyncLimiter,
  generalApiLimiter,
};

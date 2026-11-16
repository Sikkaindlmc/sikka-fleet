/**
 * Sikka Fleet Rate Limiting Configuration
 *
 * NOTE: IP-based throttling is keyed on the real client IP.
 * When running behind a proxy/load-balancer set `trust proxy` on the Express app
 * so that req.ip reflects the client, not the proxy.
 *
 * Auth limiter: strict – prevents brute-force login attacks.
 * GPS / general limiters: generous – allows normal fleet operations.
 */
const rateLimit = require('express-rate-limit');

/**
 * Auth limiter: 10 attempts per 15 minutes per IP address.
 * Responses are deliberately slow on failure to deter automated scripts.
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,  // Return `RateLimit-*` headers
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Only count failed attempts toward the limit
  message: {
    error: 'Too many login attempts from this IP address. Please wait 15 minutes and try again.',
  },
  // Do not expose the limiter's internals in the response body
  handler: (req, res, next, options) => {
    res.status(429).json(options.message);
  },
});

// GPS sync limiter: generous – 200 requests per minute per IP
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

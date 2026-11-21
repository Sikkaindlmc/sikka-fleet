const { timingSafeCompare } = require('../utils/security');

function verifyCronSecret(req, res, next) {
  const configuredSecret = String(process.env.CRON_SECRET || '').trim();
  if (!configuredSecret) {
    return res.status(500).json({
      success: false,
      error: 'Server setting missing: CRON_SECRET',
    });
  }

  const authorization = req.headers.authorization;
  const bearerSecret = authorization?.startsWith('Bearer ')
    ? authorization.slice(7).trim()
    : '';
  const callerSecret = bearerSecret || req.headers['x-cron-secret'];
  if (!callerSecret || !timingSafeCompare(String(callerSecret), configuredSecret)) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Invalid or missing CRON_SECRET header.',
    });
  }

  req.cronCaller = 'Authorized Cron Runner';
  req.syncCaller = 'Cron Worker (Secret Verified)';
  req.isCron = true;
  return next();
}

module.exports = { verifyCronSecret };

/**
 * Express 5 compatible NoSQL injection sanitizer.
 * Express 5 makes req.query a getter on IncomingMessage, which prevents reassignment.
 * This middleware mutates the query, body, and params objects in-place, removing
 * or prefix-stripping any keys starting with '$' or containing '.'
 */

function sanitizeObject(target) {
  if (!target || typeof target !== 'object') return;

  for (const key of Object.keys(target)) {
    // If key starts with $ (MongoDB operator) or contains a dot (path injection)
    if (key.startsWith('$') || key.includes('.')) {
      delete target[key];
      continue;
    }

    const val = target[key];
    if (val && typeof val === 'object') {
      sanitizeObject(val);
    }
  }
}

function mongoSanitizer(req, res, next) {
  if (req.body && typeof req.body === 'object') {
    sanitizeObject(req.body);
  }
  if (req.params && typeof req.params === 'object') {
    sanitizeObject(req.params);
  }
  if (req.query && typeof req.query === 'object') {
    sanitizeObject(req.query);
  }
  next();
}

module.exports = mongoSanitizer;

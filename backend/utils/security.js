const crypto = require('crypto');
const mongoose = require('mongoose');

/**
 * Escapes special regex characters in user input to prevent ReDoS / Regex injection.
 */
function escapeRegex(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Validates whether a given string is a valid MongoDB ObjectId.
 */
function isValidObjectId(id) {
  if (!id || typeof id !== 'string') return false;
  return mongoose.Types.ObjectId.isValid(id) && new mongoose.Types.ObjectId(id).toString() === id;
}

/**
 * Timing-safe string comparison using crypto.timingSafeEqual.
 * Prevents timing side-channel attacks on secret keys.
 */
function timingSafeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const hashA = crypto.createHash('sha256').update(a).digest();
  const hashB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

/**
 * Validates an external provider URL against SSRF (Server-Side Request Forgery).
 * Rejects private network ranges, loopbacks, link-local, and cloud metadata endpoints.
 */
function isSafeExternalUrl(inputUrl) {
  try {
    const parsed = new URL(inputUrl);
    // Only permit https and http
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return false;
    }

    const hostname = parsed.hostname.toLowerCase();

    // Block localhost, link-local, private IPs, and cloud metadata
    const blockedPatterns = [
      /^localhost$/,
      /^127\./,
      /^0\./,
      /^10\./,
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
      /^192\.168\./,
      /^169\.254\./, // AWS / GCP / Azure metadata endpoint
      /^::1$/,
      /^fc00:/,
      /^fe80:/,
    ];

    for (const pattern of blockedPatterns) {
      if (pattern.test(hostname)) {
        return false;
      }
    }

    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Strips or masks private tokens/keys from GPS URLs for safe logging and client responses.
 */
function maskUrlSecret(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return '';
  return urlStr.replace(/([?&](?:accessToken|apiKey|token|key|secret)=)([^&]+)/gi, (match, prefix, val) => {
    if (val.length <= 4) return `${prefix}••••`;
    return `${prefix}••••••••${val.slice(-4)}`;
  });
}

/**
 * Basic HTML escaping to prevent XSS in text inputs before storage or display.
 */
function sanitizeText(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

module.exports = {
  escapeRegex,
  isValidObjectId,
  timingSafeCompare,
  isSafeExternalUrl,
  maskUrlSecret,
  sanitizeText,
};

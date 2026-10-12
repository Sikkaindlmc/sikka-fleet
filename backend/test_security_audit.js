require('dotenv').config();

async function runTests() {
  console.log('--- STARTING SECURITY HARDENING DEFENSIVE TESTS ---');
  let failures = 0;
  let passes = 0;

  function assert(condition, testName) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passes++;
    } else {
      console.error(`[FAIL] ${testName}`);
      failures++;
    }
  }

  // 1. Test Security Utilities
  const { escapeRegex, isValidObjectId, timingSafeCompare, isSafeExternalUrl, maskUrlSecret } = require('./utils/security');
  
  assert(escapeRegex('test.*+?^${}()|[]\\') === 'test\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\', 'Regex escaping neutralizes special regex metacharacters');
  assert(isValidObjectId('507f1f77bcf86cd799439011') === true, 'Valid 24-hex ObjectId is recognized');
  assert(isValidObjectId('invalid-id') === false, 'Invalid ObjectId is rejected');
  assert(isValidObjectId('{"$gt":""}') === false, 'NoSQL operator injection as ObjectId is rejected');
  assert(timingSafeCompare('secret123', 'secret123') === true, 'timingSafeCompare succeeds on matching strings');
  assert(timingSafeCompare('secret123', 'secret456') === false, 'timingSafeCompare rejects mismatched strings safely');
  assert(isSafeExternalUrl('https://api.wheelseye.com/v1/data') === true, 'Safe public HTTPS API URL is accepted');
  assert(isSafeExternalUrl('http://127.0.0.1:5000/secret') === false, 'SSRF: Localhost IP is blocked');
  assert(isSafeExternalUrl('http://localhost:5000/secret') === false, 'SSRF: Localhost hostname is blocked');
  assert(isSafeExternalUrl('http://169.254.169.254/latest/meta-data/') === false, 'SSRF: Cloud metadata IP is blocked');
  assert(isSafeExternalUrl('http://10.0.0.1/admin') === false, 'SSRF: Private Class A IP is blocked');
  assert(isSafeExternalUrl('http://192.168.1.1/router') === false, 'SSRF: Private Class C IP is blocked');
  assert(isSafeExternalUrl('ftp://example.com/file') === false, 'SSRF: Non-HTTP/HTTPS protocol is blocked');
  
  const masked = maskUrlSecret('https://api.wheelseye.com/currentLoc?accessToken=abcdef1234567890');
  assert(!masked.includes('abcdef1234567890') && masked.includes('••••'), 'Sensitive access tokens in URLs are masked');

  // 2. Test MongoSanitize middleware directly
  const mongoSanitize = require('./middleware/mongoSanitize');
  const mockReq = {
    body: { username: 'admin', password: { $gt: '' }, nested: { $ne: null, safe: 'ok' } },
    query: { filter: { $regex: '.*' }, search: 'normal' },
    params: { id: '123' }
  };
  mongoSanitize(mockReq, {}, () => {});
  assert(mockReq.body.password.$gt === undefined, 'MongoSanitize strips $gt operator from body');
  assert(mockReq.body.nested.$ne === undefined && mockReq.body.nested.safe === 'ok', 'MongoSanitize strips nested $ne operator from body');
  assert(mockReq.query.filter.$regex === undefined && mockReq.query.search === 'normal', 'MongoSanitize strips $regex from query');

  // 3. Test Rate Limiter Middleware
  const { authLimiter, generalApiLimiter } = require('./middleware/rateLimiter');
  assert(typeof authLimiter === 'function', 'authLimiter middleware is configured');
  assert(typeof generalApiLimiter === 'function', 'generalApiLimiter middleware is configured');

  console.log(`\nTests Completed: ${passes} Passed, ${failures} Failed`);
  process.exit(failures > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  decryptGpsCredential,
  encryptGpsCredential,
  maskGpsCredential,
} = require('../utils/gpsCredentialCrypto');

test('GPS setting credentials are encrypted at rest and masked to their last four characters', () => {
  const previousKey = process.env.GPS_CREDENTIAL_ENCRYPTION_KEY;
  process.env.GPS_CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  try {
    const secret = 'provider-secret-value';
    const encrypted = encryptGpsCredential(secret);
    assert.ok(encrypted.startsWith('enc:v1:'));
    assert.doesNotMatch(encrypted, /provider-secret-value/);
    assert.equal(decryptGpsCredential(encrypted), secret);
    assert.equal(maskGpsCredential(encrypted), '••••••••••••alue');
  } finally {
    if (previousKey === undefined) delete process.env.GPS_CREDENTIAL_ENCRYPTION_KEY;
    else process.env.GPS_CREDENTIAL_ENCRYPTION_KEY = previousKey;
  }
});

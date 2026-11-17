const crypto = require('crypto');

const PREFIX = 'enc:v1:';

function getEncryptionKey() {
  const configured = process.env.GPS_CREDENTIAL_ENCRYPTION_KEY || '';
  const key = /^[a-f\d]{64}$/i.test(configured)
    ? Buffer.from(configured, 'hex')
    : Buffer.from(configured, 'base64');
  if (key.length !== 32) {
    throw new Error('GPS_CREDENTIAL_ENCRYPTION_KEY must encode exactly 32 bytes.');
  }
  return key;
}

function encryptGpsCredential(value) {
  if (!value) return '';
  if (String(value).startsWith(PREFIX)) return String(value);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return `${PREFIX}${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${ciphertext.toString('base64')}`;
}

function decryptGpsCredential(value) {
  if (!value || !String(value).startsWith(PREFIX)) return value || '';
  const [ivText, tagText, ciphertextText] = String(value).slice(PREFIX.length).split(':');
  if (!ivText || !tagText || !ciphertextText) {
    throw new Error('Stored GPS credential has an invalid encrypted format.');
  }
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    getEncryptionKey(),
    Buffer.from(ivText, 'base64')
  );
  decipher.setAuthTag(Buffer.from(tagText, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextText, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

function maskGpsCredential(value) {
  const credential = decryptGpsCredential(value);
  return credential ? `••••••••••••${credential.slice(-4)}` : '';
}

module.exports = {
  decryptGpsCredential,
  encryptGpsCredential,
  maskGpsCredential,
};

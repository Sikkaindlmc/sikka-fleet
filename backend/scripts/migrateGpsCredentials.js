const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
require('dotenv').config();
const connectDB = require('../config/db');
const GpsSetting = require('../models/GpsSetting');
const { encryptGpsCredential } = require('../utils/gpsCredentialCrypto');

async function migrateGpsCredentials() {
  await connectDB();
  const settings = await GpsSetting.find({
    provider: /wheels.?eye/i,
    archived: { $ne: true },
  });
  let updated = 0;
  for (const setting of settings) {
    let changed = false;
    for (const field of ['encryptedApiKey']) {
      const current = setting[field];
      if (current && !String(current).startsWith('enc:v1:')) {
        setting[field] = encryptGpsCredential(current);
        changed = true;
      }
    }
    if (/wheels/i.test(setting.provider || '') && setting.apiUrl) {
      try {
        const url = new URL(setting.apiUrl);
        for (const key of ['accessToken', 'access_token', 'apiKey', 'api_key', 'token', 'key', 'secret']) {
          if (!url.searchParams.has(key)) continue;
          const urlCredential = url.searchParams.get(key) || '';
          if (urlCredential && !setting.encryptedApiKey) {
            setting.encryptedApiKey = encryptGpsCredential(urlCredential);
          }
          url.searchParams.delete(key);
          setting.apiUrl = url.toString();
          changed = true;
        }
      } catch (_) {
        throw new Error('A saved WheelsEye API URL is invalid; correct it before migrating credentials.');
      }
    }
    if (changed) {
      await setting.save();
      updated += 1;
    }
  }
  console.log(`Encrypted credentials for ${updated} GPS setting(s).`);
}

migrateGpsCredentials()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`GPS credential migration failed: ${error.message}`);
    process.exit(1);
  });

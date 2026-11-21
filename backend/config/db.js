const path = require('path');
// Ensure environment variables are loaded
if (!process.env.MONGODB_URI && !process.env.MONGO_URI) {
  require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
  require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
  require('dotenv').config();
}

const mongoose = require('mongoose');
// Register all models and schema relations
require('../models');
const { DEFAULT_PROVIDER_URLS } = require('../utils/gpsProvider');
const { encryptGpsCredential } = require('../utils/gpsCredentialCrypto');

async function ensureWheelsEyeSetting() {
  const GpsSetting = mongoose.model('GpsSetting');
  const query = {
    archived: { $ne: true },
    $or: [{ provider: /wheels.?eye/i }, { apiUrl: /wheelseye/i }],
  };
  const setting = await GpsSetting.findOne(query).sort({ updatedAt: -1 });
  if (!setting) {
    let apiUrl = (process.env.WHEELSEYE_API_URL || DEFAULT_PROVIDER_URLS.wheelseye).trim();
    let apiCredential = '';
    try {
      const parsedUrl = new URL(apiUrl);
      for (const key of ['accessToken', 'access_token', 'apiKey', 'api_key', 'token', 'key', 'secret']) {
        apiCredential = apiCredential || parsedUrl.searchParams.get(key) || '';
        parsedUrl.searchParams.delete(key);
      }
      apiUrl = parsedUrl.toString();
    } catch (error) {
      throw new Error('Configured WheelsEye API URL is invalid.');
    }
    await GpsSetting.create({
      provider: 'WheelsEye GPS',
      apiUrl,
      ...(apiCredential ? { encryptedApiKey: encryptGpsCredential(apiCredential) } : {}),
      status: 'Active',
      pollIntervalSeconds: 1800,
    });
    return;
  }

  const update = { provider: 'WheelsEye GPS', status: 'Active' };
  let apiUrl = setting.apiUrl || DEFAULT_PROVIDER_URLS.wheelseye;
  let apiCredential = '';
  try {
    const parsedUrl = new URL(apiUrl);
    for (const key of ['accessToken', 'access_token', 'apiKey', 'api_key', 'token', 'key', 'secret']) {
      apiCredential = apiCredential || parsedUrl.searchParams.get(key) || '';
      parsedUrl.searchParams.delete(key);
    }
    apiUrl = parsedUrl.toString();
  } catch (error) {
    throw new Error('Saved WheelsEye API URL is invalid.');
  }
  update.apiUrl = apiUrl;
  if (apiCredential && !setting.encryptedApiKey) {
    update.encryptedApiKey = encryptGpsCredential(apiCredential);
  }
  await GpsSetting.updateOne(
    { _id: setting._id },
    {
      $set: update,
      $unset: {
        encryptedUsername: '',
        encryptedPassword: '',
        encryptedBasicAuth: '',
      },
    }
  );
}

async function ensureFleetxSetting() {
  const GpsSetting = mongoose.model('GpsSetting');
  const query = {
    archived: { $ne: true },
    $or: [{ provider: /fleetx/i }, { apiUrl: /fleetx/i }],
  };
  const setting = await GpsSetting.findOne(query).sort({ updatedAt: -1 });
  const apiUrl = (process.env.FLEETX_API_BASE_URL || 'https://api.fleetx.io').trim();

  if (!setting) {
    await GpsSetting.create({
      provider: 'FleetX',
      apiUrl,
      status: 'Active',
      pollIntervalSeconds: 1800,
    });
    return;
  }

  await GpsSetting.updateOne(
    { _id: setting._id },
    {
      $set: {
        provider: 'FleetX',
        apiUrl,
        status: 'Active',
      },
      $unset: {
        encryptedUsername: '',
        encryptedPassword: '',
        encryptedBasicAuth: '',
        encryptedApiKey: '',
      },
    }
  );
}

const connectDB = async () => {
  // Reuse existing connection if available (for serverless environments like Vercel)
  if (mongoose.connection.readyState >= 1) {
    await ensureWheelsEyeSetting();
    await ensureFleetxSetting();
    return mongoose.connection;
  }

  // Direct Atlas replica-set fallback if SRV DNS encounters network/proxy issues
  const directAtlasURI = (process.env.MONGODB_DIRECT_URI || '').trim();
  const primaryURI = process.env.MONGODB_URI || process.env.MONGO_URI || directAtlasURI;
  const localURI = 'mongodb://127.0.0.1:27017/sikka_fleet';
  const dbName = process.env.MONGODB_DB_NAME || 'sikka_fleet';

  // 1. Try Primary MongoDB URI (MongoDB Atlas SRV or direct replica set)
  if (primaryURI && !primaryURI.includes('127.0.0.1') && !primaryURI.includes('localhost')) {
    try {
      console.log(`[Database] Connecting to MongoDB Atlas...`);
      const conn = await mongoose.connect(primaryURI, {
        dbName,
        autoIndex: true,
        serverSelectionTimeoutMS: 8000,
      });
      await ensureWheelsEyeSetting();
      await ensureFleetxSetting();
      console.log(`[Database] MongoDB Atlas Connected: ${conn.connection.host}/${conn.connection.name}`);
      return conn;
    } catch (err) {
      console.warn(`[Database Warning] Atlas SRV connection failed (${err.message}).`);
      
      // If error was related to DNS or SRV lookup, try direct replica set endpoints
      if (directAtlasURI && err.message && (err.message.includes('querySrv') || err.message.includes('ENOTFOUND') || err.message.includes('buffering timed out'))) {
        try {
          console.log(`[Database] Attempting direct Atlas replica set connection fallback...`);
          const conn = await mongoose.connect(directAtlasURI, {
            dbName,
            autoIndex: true,
            serverSelectionTimeoutMS: 8000,
          });
          await ensureWheelsEyeSetting();
          await ensureFleetxSetting();
          console.log(`[Database] MongoDB Atlas Connected via direct replica set: ${conn.connection.host}/${conn.connection.name}`);
          return conn;
        } catch (directErr) {
          console.warn(`[Database Warning] Direct Atlas connection also failed (${directErr.message}).`);
        }
      }
      
      console.warn(`[Database Warning] Falling back to local MongoDB instance: ${localURI}`);
    }
  }

  // 2. Fallback to Local MongoDB
  try {
    const conn = await mongoose.connect(localURI, {
      dbName: 'sikka_fleet',
      autoIndex: true,
      serverSelectionTimeoutMS: 3000,
    });
    await ensureWheelsEyeSetting();
    await ensureFleetxSetting();
    console.log(`[Database] Local MongoDB Connected: ${conn.connection.host}/${conn.connection.name}`);
    return conn;
  } catch (err) {
    console.error(`[Database Error] Could not connect to either Atlas or Local MongoDB: ${err.message}`);
  }
};

module.exports = connectDB;

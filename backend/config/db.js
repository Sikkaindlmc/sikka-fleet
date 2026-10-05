const path = require('path');
// Ensure environment variables are loaded
if (!process.env.MONGODB_URI && !process.env.MONGO_URI) {
  require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
  require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
  require('dotenv').config();
}

const mongoose = require('mongoose');

const connectDB = async () => {
  // Reuse existing connection if available (for serverless environments like Vercel)
  if (mongoose.connection.readyState >= 1) {
    return mongoose.connection;
  }

  const primaryURI = process.env.MONGODB_URI || process.env.MONGO_URI;
  const localURI = 'mongodb://127.0.0.1:27017/sikka_fleet';
  const dbName = process.env.MONGODB_DB_NAME || 'sikka_fleet';

  // Direct Atlas replica-set fallback if SRV DNS encounters network/proxy issues
  const directAtlasURI = 'mongodb://sikkalmc_db_user:p15pS1cvdirZuW8p@ac-reo4oj8-shard-00-00.9vylwot.mongodb.net:27017,ac-reo4oj8-shard-00-01.9vylwot.mongodb.net:27017,ac-reo4oj8-shard-00-02.9vylwot.mongodb.net:27017/sikka_fleet?ssl=true&authSource=admin&replicaSet=atlas-5s2o5v-shard-0&retryWrites=true&w=majority';

  // 1. Try Primary MongoDB URI (MongoDB Atlas SRV)
  if (primaryURI && !primaryURI.includes('127.0.0.1') && !primaryURI.includes('localhost')) {
    try {
      console.log(`[Database] Connecting to MongoDB Atlas...`);
      const conn = await mongoose.connect(primaryURI, {
        dbName,
        autoIndex: true,
        serverSelectionTimeoutMS: 8000,
      });
      console.log(`[Database] MongoDB Atlas Connected: ${conn.connection.host}/${conn.connection.name}`);
      return conn;
    } catch (err) {
      console.warn(`[Database Warning] Atlas SRV connection failed (${err.message}).`);
      
      // If error was related to DNS or SRV lookup, try direct replica set endpoints
      if (err.message && (err.message.includes('querySrv') || err.message.includes('ENOTFOUND') || err.message.includes('buffering timed out'))) {
        try {
          console.log(`[Database] Attempting direct Atlas replica set connection fallback...`);
          const conn = await mongoose.connect(directAtlasURI, {
            dbName,
            autoIndex: true,
            serverSelectionTimeoutMS: 8000,
          });
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
    console.log(`[Database] Local MongoDB Connected: ${conn.connection.host}/${conn.connection.name}`);
    return conn;
  } catch (err) {
    console.error(`[Database Error] Could not connect to either Atlas or Local MongoDB: ${err.message}`);
  }
};

module.exports = connectDB;

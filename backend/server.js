const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const connectDB = require('./config/db');
const { startGpsScheduler } = require('./services/gpsScheduler');
const { startGpsCronWorker } = require('./services/gpsCronWorker');

const authRoutes = require('./routes/authRoutes');
const plantRoutes = require('./routes/plantRoutes');
const vehicleRoutes = require('./routes/vehicleRoutes');
const gpsRoutes = require('./routes/gpsRoutes');
const gpsSyncRoutes = require('./routes/gpsSyncRoutes');
const fleetRoutes = require('./routes/fleetRoutes');
const cronRoutes = require('./routes/cronRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const userRoutes = require('./routes/userRoutes');
const driverRoutes = require('./routes/driverRoutes');
const reportRoutes = require('./routes/reportRoutes');
const notificationRoutes = require('./routes/notificationRoutes');

const helmet = require('helmet');
const mongoSanitize = require('./middleware/mongoSanitize');
const { generalApiLimiter } = require('./middleware/rateLimiter');

const app = express();
const PORT = process.env.PORT || 5000;

// Trust reverse proxies (Vercel, Cloudflare, mobile carrier CGNAT)
app.set('trust proxy', true);

// Connect to MongoDB
connectDB();

// Security: Disable Express fingerprinting header
app.disable('x-powered-by');

// Security: Enforce HTTP security headers via Helmet
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false, // Managed by frontend Next.js headers
  })
);

// Ensure all models are registered
require('./models');

// Universal Multi-Network CORS: Full access from all IP addresses, networks, and origins
app.use(
  cors({
    origin: (origin, callback) => {
      // Unconditionally allow all network clients, IPs, browsers, and mobile devices
      callback(null, true);
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-cron-secret', 'x-requested-with'],
    credentials: true,
  })
);

// Security: Limit request payload sizes to prevent memory-exhaustion DoS
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// Security: Sanitize incoming input against MongoDB Operator Injection ($ and .)
app.use(mongoSanitize);

// Global rate limiting on API surface
app.use('/api', generalApiLimiter);

app.use(morgan('dev'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    application: 'Sikka Fleet API',
    firm: 'Sikka LMC',
    timestamp: new Date().toISOString(),
  });
});

// Cross-Platform Version Management & Automatic Update Check (Web, Android, iOS)
app.get('/api/app/version', (req, res) => {
  res.json({
    latestVersion: '1.0.1',
    webVersion: '1.0.1',
    webBuildId: '20261013-02',
    minimumSupportedVersion: '1.0.0',
    buildNumber: 1,
    nativeAndroidVersionCode: 1,
    latestAndroidVersionCode: 1,
    minSupportedAndroidVersionCode: 1,
    mandatoryNativeUpdate: false,
    apkDownloadUrl: 'https://sikka-fleet.vercel.app/SikkaFleet.apk',
    androidPlayStoreUrl: 'https://play.google.com/store/apps/details?id=com.sikkaind.sikkafleet',
    iosAppStoreUrl: 'https://apps.apple.com/app/sikka-fleet/id6740000000',
    releaseNotes: 'Sikka Fleet v1.0.1: Automatic web update sync without APK reinstallation, Outside vehicle trip planning, and enhanced real-time GPS tracking.',
    features: [
      'Automatic Web Updates loaded directly from production',
      'Outside Vehicles Next Trip Plan & Edit functionality',
      'Universal iOS and Android connectivity',
      'Real-time Wheelseye GPS auto-sync every 30 minutes',
      'Plant geofence inside/outside monitoring',
      'Secure Driver and User authentication',
    ],
    timestamp: new Date().toISOString(),
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/plants', plantRoutes);
app.use('/api/vehicles', vehicleRoutes);
app.use('/api/gps', gpsRoutes);
app.use('/api/gps-sync', gpsSyncRoutes);
app.use('/api/fleet', fleetRoutes);
app.use('/api/cron', cronRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/users', userRoutes);
app.use('/api/drivers', driverRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/notifications', notificationRoutes);

// Centralized Error Handling Middleware
app.use((err, req, res, next) => {
  const isProd = process.env.NODE_ENV === 'production';
  console.error('[Unhandled Server Error]:', err.stack || err);

  const statusCode = err.status || 500;
  const userSafeMessage = isProd && statusCode === 500
    ? 'An unexpected internal server error occurred.'
    : err.message || 'Internal server error occurred.';

  res.status(statusCode).json({
    error: userSafeMessage,
  });
});

// Start Server if run directly
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`=========================================`);
    console.log(`🚀 Sikka Fleet Backend API running on port ${PORT}`);
    console.log(`📡 URL: http://0.0.0.0:${PORT}`);
    console.log(`📡 Local: http://localhost:${PORT}`);
    console.log(`📡 Production: https://fleet.sikkaind.com/api`);
    console.log(`=========================================`);

    // Start 24x7 autonomous server-side GPS 30-minute scheduler
    startGpsScheduler();

  });
}

module.exports = app;

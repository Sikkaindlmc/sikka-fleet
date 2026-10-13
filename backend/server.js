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

// Security: CORS Allowlist configuration
const rawAllowedOrigins = process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000,http://localhost:5000,https://sikka-fleet.vercel.app';
const allowedOriginsList = rawAllowedOrigins.split(',').map((o) => o.trim()).filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin or 'null' origin (e.g. mobile native apps, Android WebView sandboxed frames, curl, server-side cron triggers)
      if (!origin || origin === 'null') return callback(null, true);

      // Check configured allowlist
      if (allowedOriginsList.includes(origin) || allowedOriginsList.includes('*')) {
        return callback(null, true);
      }

      // Allow Capacitor mobile origins and local network access
      if (
        origin === 'http://localhost' ||
        origin === 'https://localhost' ||
        origin.startsWith('capacitor://') ||
        origin.startsWith('ionic://') ||
        origin.startsWith('http://192.168.') ||
        origin.startsWith('http://10.') ||
        origin.startsWith('http://172.') ||
        origin.includes('sikka-fleet')
      ) {
        return callback(null, true);
      }

      return callback(new Error('CORS request blocked by Sikka Fleet security policy.'));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-cron-secret'],
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
  app.listen(PORT, () => {
    console.log(`=========================================`);
    console.log(`🚀 Sikka Fleet Backend API running on port ${PORT}`);
    console.log(`📡 URL: http://localhost:${PORT}`);
    console.log(`=========================================`);

    // Start 24x7 autonomous server-side GPS 30-minute scheduler
    startGpsScheduler();

  });
}

module.exports = app;

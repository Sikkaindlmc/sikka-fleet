const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const connectDB = require('./config/db');
const { startGpsPoller } = require('./services/gpsPollerService');

const authRoutes = require('./routes/authRoutes');
const plantRoutes = require('./routes/plantRoutes');
const vehicleRoutes = require('./routes/vehicleRoutes');
const gpsRoutes = require('./routes/gpsRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const userRoutes = require('./routes/userRoutes');
const driverRoutes = require('./routes/driverRoutes');
const reportRoutes = require('./routes/reportRoutes');

const app = express();
const PORT = process.env.PORT || 5000;

// Connect to MongoDB
connectDB();

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
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
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/users', userRoutes);
app.use('/api/drivers', driverRoutes);
app.use('/api/reports', reportRoutes);

// Centralized Error Handling Middleware
app.use((err, req, res, next) => {
  console.error('[Unhandled Server Error]:', err.stack || err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error occurred.',
  });
});

// Start Server if run directly
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`=========================================`);
    console.log(`🚀 Sikka Fleet Backend API running on port ${PORT}`);
    console.log(`📡 URL: http://localhost:${PORT}`);
    console.log(`=========================================`);

    // Start background GPS polling worker (auto sync GPS every 30 Min mandatory)
    startGpsPoller(30 * 60);
  });
}

module.exports = app;

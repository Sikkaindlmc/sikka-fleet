const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('../models');
const User = require('../models/User');
const Driver = require('../models/Driver');
const Plant = require('../models/Plant');
const { JWT_SECRET, getJwtSecret, verifyToken } = require('../middleware/auth');
const connectDB = require('../config/db');

const router = express.Router();

const { authLimiter } = require('../middleware/rateLimiter');

// POST /api/auth/login
router.post('/login', authLimiter, async (req, res) => {
  try {
    await connectDB();
    const { username, password, loginType = 'User', location } = req.body;

    if (!username || typeof username !== 'string' || !password || typeof password !== 'string') {
      return res.status(400).json({
        error: loginType === 'Driver'
          ? 'DL Number and registered mobile number are required.'
          : 'Username and password are required.',
      });
    }

    // =========================================================================
    // 1. DRIVER LOGIN
    // =========================================================================
    if (loginType === 'Driver') {
      const trimmedDl = username.trim().toUpperCase();
      const cleanedMobile = password.toString().replace(/\D/g, '');

      const driver = await Driver.findOne({ dlNumber: trimmedDl });
      if (!driver) {
        return res.status(401).json({ error: 'Invalid DL Number or mobile number.' });
      }

      // Check mobile number matches
      if (driver.mobileNumber !== cleanedMobile) {
        return res.status(401).json({ error: 'Invalid DL Number or mobile number.' });
      }

      // Driver status check: only Active drivers allowed
      if (driver.status !== 'Active') {
        return res.status(403).json({
          error: 'Driver account is inactive. Please contact your fleet administrator.',
        });
      }

      // Record driver location if provided, and record login timestamp
      if (
        location &&
        typeof location.latitude === 'number' &&
        typeof location.longitude === 'number'
      ) {
        driver.lastLoginLocation = {
          latitude: location.latitude,
          longitude: location.longitude,
          accuracy: typeof location.accuracy === 'number' ? location.accuracy : null,
          capturedAt: new Date(),
        };
      }
      driver.lastLoginAt = new Date();
      await driver.save();

      // Issue JWT token signed with HS256
      const token = jwt.sign(
        {
          userId: driver._id,
          driverId: driver._id,
          username: driver.dlNumber,
          fullName: driver.driverName,
          role: 'Driver',
          loginType: 'Driver',
        },
        getJwtSecret(),
        { algorithm: 'HS256', expiresIn: '30d' }
      );

      return res.json({
        message: 'Driver login successful',
        token,
        user: {
          id: driver._id,
          fullName: driver.driverName,
          username: driver.dlNumber,
          role: 'Driver',
          loginType: 'Driver',
          accessPages: ['Dashboard'],
          accessPlants: [],
          status: driver.status,
        },
      });
    }

    // =========================================================================
    // 2. USER LOGIN
    // =========================================================================
    const trimmedUsername = username.trim().toLowerCase();
    const user = await User.findOne({ username: trimmedUsername }).populate('accessPlants', 'plantName status');

    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    if (user.status !== 'Active') {
      return res.status(403).json({ error: 'Your account is inactive. Please contact your administrator.' });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    // Generate JWT signed with HS256
    const token = jwt.sign(
      {
        userId: user._id,
        username: user.username,
        role: user.role || 'User',
        loginType: 'User',
      },
      getJwtSecret(),
      { algorithm: 'HS256', expiresIn: '30d' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        fullName: user.fullName,
        username: user.username,
        role: user.role || 'User',
        accessPages: user.accessPages,
        accessPlants: user.accessPlants,
        status: user.status,
      },
    });
  } catch (error) {
    console.error('[Login Error]:', error);
    res.status(500).json({ error: 'Login service encountered an unexpected error.' });
  }
});

// GET /api/auth/me
router.get('/me', verifyToken, async (req, res) => {
  try {
    res.json({
      user: {
        id: req.user._id,
        fullName: req.user.fullName,
        username: req.user.username,
        role: req.user.role || 'User',
        accessPages: req.user.accessPages,
        accessPlants: req.user.accessPlants || [],
        status: req.user.status,
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch user profile.' });
  }
});

module.exports = router;

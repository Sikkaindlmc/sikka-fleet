const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Driver = require('../models/Driver');
require('../models/Plant');
const connectDB = require('../config/db');

const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('FATAL: JWT_SECRET environment variable is missing.');
    }
    return 'sikka_fleet_super_secret_jwt_key_2026_production';
  }
  return secret;
};

const JWT_SECRET = getJwtSecret();

const verifyToken = async (req, res, next) => {
  try {
    await connectDB();

    let token = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else if (req.query && req.query.token) {
      // Query tokens are strictly restricted to file export / download endpoints
      const isDownloadEndpoint = req.path.includes('/export') || req.path.includes('/download');
      if (isDownloadEndpoint) {
        token = req.query.token;
      }
    }

    if (!token || typeof token !== 'string') {
      return res.status(401).json({ 
        error: 'Authentication required. No valid token provided.',
        code: 'NO_TOKEN'
      });
    }

    let decoded = null;
    try {
      decoded = jwt.verify(token, getJwtSecret(), {
        algorithms: ['HS256'],
      });
    } catch (err) {
      return res.status(401).json({ 
        error: 'Invalid or expired authentication token.',
        code: err.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID'
      });
    }

    if (!decoded || !decoded.userId || !mongoose.Types.ObjectId.isValid(decoded.userId)) {
      return res.status(401).json({ 
        error: 'Invalid authentication token payload.',
        code: 'TOKEN_INVALID'
      });
    }

    let account = null;
    if (decoded.role === 'Driver') {
      const driver = await Driver.findById(decoded.userId);
      if (!driver) {
        return res.status(401).json({ 
          error: 'Driver account not found.',
          code: 'USER_NOT_FOUND'
        });
      }

      if (driver.status !== 'Active') {
        return res.status(403).json({ 
          error: 'Your driver account is inactive. Please contact your administrator.',
          code: 'ACCOUNT_INACTIVE'
        });
      }

      account = {
        _id: driver._id,
        id: driver._id.toString(),
        fullName: driver.driverName,
        username: driver.dlNumber,
        role: 'Driver',
        status: driver.status,
        accessPages: ['Dashboard'],
        accessPlants: [],
      };
    } else {
      const user = await User.findById(decoded.userId).populate('accessPlants', 'plantName status');
      if (!user) {
        return res.status(401).json({ 
          error: 'User account not found.',
          code: 'USER_NOT_FOUND'
        });
      }

      if (user.status !== 'Active') {
        return res.status(403).json({ 
          error: 'Your account is inactive. Please contact your administrator.',
          code: 'ACCOUNT_INACTIVE'
        });
      }
      account = user;
    }

    req.user = account;
    next();
  } catch (error) {
    console.error('[Auth Middleware Error]:', error.message || error);
    res.status(401).json({ 
      error: 'Authentication verification failed. Please sign in again.',
      code: 'AUTH_FAILED' 
    });
  }
};

const checkPageAccess = (pageName) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized.' });
    }

    // Administrator always has unrestricted access to ALL current and future pages
    if (req.user.role === 'Admin') {
      return next();
    }

    // Check if user has explicit access to this page
    if (!Array.isArray(req.user.accessPages) || !req.user.accessPages.includes(pageName)) {
      return res.status(403).json({
        error: `Access Denied: You do not have authorization to access '${pageName}'.`,
      });
    }

    next();
  };
};

const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized.' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Access Denied: Restricted to role(s): ${allowedRoles.join(', ')}.`,
      });
    }
    next();
  };
};

const checkPlantAccess = (plantIdParamKey = 'plantId') => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized.' });
    }

    // Admin has full access to all plants
    if (req.user.role === 'Admin') {
      return next();
    }

    const plantId = req.params[plantIdParamKey] || req.body[plantIdParamKey] || req.query[plantIdParamKey];
    if (!plantId) {
      return next();
    }

    // If user has specific plant assignments, verify that plantId is among them
    if (req.user.accessPlants && req.user.accessPlants.length > 0) {
      const allowedIds = req.user.accessPlants.map((p) => (p._id ? p._id.toString() : p.toString()));
      if (!allowedIds.includes(plantId.toString())) {
        return res.status(403).json({
          error: 'Access Denied: You do not have authorization for this plant.',
        });
      }
    }

    next();
  };
};

module.exports = {
  JWT_SECRET,
  getJwtSecret,
  verifyToken,
  checkPageAccess,
  requireRole,
  checkPlantAccess,
};

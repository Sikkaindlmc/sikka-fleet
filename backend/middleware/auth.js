const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Driver = require('../models/Driver');

const getJwtSecret = () => process.env.JWT_SECRET || 'sikka_fleet_super_secret_jwt_key_2026';
const JWT_SECRET = getJwtSecret();

const verifyToken = async (req, res, next) => {
  try {
    let token = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else if (req.query && req.query.token) {
      token = req.query.token;
    }

    if (!token) {
      return res.status(401).json({ 
        error: 'Authentication required. No token provided.',
        code: 'NO_TOKEN'
      });
    }

    const currentSecret = getJwtSecret();
    const candidateSecrets = Array.from(new Set([
      currentSecret,
      'sikka_fleet_super_secret_jwt_key_2026_production',
      'sikka_fleet_super_secret_jwt_key_2026'
    ])).filter(Boolean);

    let decoded = null;
    let lastError = null;

    for (const secret of candidateSecrets) {
      try {
        decoded = jwt.verify(token, secret);
        if (decoded) break;
      } catch (err) {
        lastError = err;
      }
    }

    if (!decoded) {
      return res.status(401).json({ 
        error: 'Invalid or expired authentication token.',
        code: lastError?.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID'
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
    console.error('[Auth Middleware Error]:', error);
    res.status(500).json({ error: 'Authentication verification failed.' });
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

const checkPlantAccess = (plantIdParamKey = 'plantId') => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized.' });
    }

    const plantId = req.params[plantIdParamKey] || req.body[plantIdParamKey] || req.query[plantIdParamKey];
    if (!plantId) {
      return next();
    }

    // If user has specific plant assignments, verify that plantId is among them
    // Note: If an admin has all plants or explicit access, allow
    if (req.user.accessPlants && req.user.accessPlants.length > 0) {
      const allowedIds = req.user.accessPlants.map((p) => p._id.toString());
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
  checkPlantAccess,
};

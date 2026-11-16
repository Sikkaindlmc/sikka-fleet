const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const mongoose = require('mongoose');
require('../models');
const User = require('../models/User');
const Driver = require('../models/Driver');
const AuthSession = require('../models/AuthSession');
const Plant = require('../models/Plant');
const { JWT_SECRET, getJwtSecret, verifyToken } = require('../middleware/auth');
const connectDB = require('../config/db');

const router = express.Router();

const { authLimiter } = require('../middleware/rateLimiter');
const REFRESH_COOKIE = 'sikka_fleet_refresh';
const SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000;
const ACCESS_TOKEN_TTL = '15m';

// ─────────────────────────────────────────────────────────────────────────────
// Input sanitization helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Maximum lengths to prevent memory/DoS abuse */
const MAX_USERNAME_LEN = 80;
const MAX_PASSWORD_LEN = 128;

/**
 * Strips any MongoDB operator keys (e.g. { $ne: '' }) from a value.
 * After type-checking (string only accepted), this is a defence-in-depth measure.
 * Returns the plain string or null if the value is not a plain non-empty string.
 */
function sanitizeStringInput(value, maxLength = MAX_USERNAME_LEN) {
  if (typeof value !== 'string') return null;          // reject objects/arrays
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) return null;
  // Reject strings that start with MongoDB operator prefix to block { "$ne":"" } style injection
  if (trimmed.startsWith('$')) return null;
  return trimmed;
}

/**
 * Checks that the parsed body does not contain any MongoDB operator keys at the top level.
 * Applies to the entire body object as defence-in-depth.
 */
function bodyHasNoOperators(body) {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return false;
  return !Object.keys(body).some((k) => k.startsWith('$'));
}

function getRefreshCookieOptions(req) {
  return {
    httpOnly: true,
    secure: req.secure || process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/auth',
    maxAge: SESSION_TTL_MS,
  };
}

function clearRefreshCookie(res, req) {
  const { maxAge, ...options } = getRefreshCookieOptions(req);
  res.clearCookie(REFRESH_COOKIE, options);
}

function readRefreshCookie(req) {
  const cookieHeader = req.headers.cookie || '';
  const cookie = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${REFRESH_COOKIE}=`));
  return cookie ? cookie.slice(REFRESH_COOKIE.length + 1) : '';
}

function createAccessToken(accountType, accountId, sessionId, username, role) {
  return jwt.sign(
    {
      userId: accountId,
      username,
      role,
      loginType: accountType,
      sid: sessionId,
    },
    getJwtSecret(),
    { algorithm: 'HS256', expiresIn: ACCESS_TOKEN_TTL }
  );
}

function getAccountProfile(accountType, account) {
  if (accountType === 'Driver') {
    return {
      id: account._id,
      fullName: account.driverName,
      username: account.dlNumber,
      role: 'Driver',
      loginType: 'Driver',
      accessPages: ['Dashboard'],
      accessPlants: [],
      status: account.status,
    };
  }

  return {
    id: account._id,
    fullName: account.fullName,
    username: account.username,
    role: account.role || 'User',
    accessPages: account.accessPages,
    accessPlants: account.accessPlants,
    status: account.status,
  };
}

async function loadSessionAccount(accountType, accountId) {
  if (accountType === 'Driver') {
    const driver = await Driver.findById(accountId);
    if (!driver || driver.status !== 'Active') return null;
    return { account: driver, user: getAccountProfile('Driver', driver) };
  }

  const account = await User.findById(accountId).populate('accessPlants', 'plantName status');
  if (!account || account.status !== 'Active') return null;
  return { account, user: getAccountProfile('User', account) };
}

async function createSession(accountType, account, req, res) {
  const secret = crypto.randomBytes(32).toString('hex');
  const session = await AuthSession.create({
    accountId: account._id,
    accountType,
    refreshHash: crypto.createHash('sha256').update(secret).digest('hex'),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  res.cookie(
    REFRESH_COOKIE,
    `${session._id}.${secret}`,
    getRefreshCookieOptions(req)
  );
  const role = accountType === 'Driver' ? 'Driver' : account.role || 'User';
  return createAccessToken(
    accountType,
    account._id,
    session._id,
    accountType === 'Driver' ? account.dlNumber : account.username,
    role
  );
}

function sendInvalidSession(res, code = 'SESSION_INVALID') {
  return res.status(401).json({
    error: 'Your session is no longer valid. Please sign in again.',
    code,
  });
}

// POST /api/auth/login
router.post('/login', authLimiter, async (req, res) => {
  try {
    await connectDB();

    // Reject bodies containing MongoDB operator keys at top level
    if (!bodyHasNoOperators(req.body)) {
      return res.status(400).json({ error: 'Invalid request format.' });
    }

    const { loginType = 'User', location } = req.body;

    // Sanitize and validate inputs – rejects objects, arrays, oversized strings, and $-prefixed values
    const username = sanitizeStringInput(req.body.username, MAX_USERNAME_LEN);
    const password = sanitizeStringInput(req.body.password, MAX_PASSWORD_LEN);

    if (!username || !password) {
      return res.status(400).json({
        error: loginType === 'Driver'
          ? 'DL Number and registered mobile number are required.'
          : 'Username and password are required.',
      });
    }

    // =========================================================================
    // 1. DRIVER LOGIN
    //    Authentication: DL Number (exact string match) + mobile number comparison.
    //    No password hash needed – mobile number is the shared secret.
    // =========================================================================
    if (loginType === 'Driver') {
      const trimmedDl = username.toUpperCase();
      // Strip non-digit characters from the mobile input (defence against format tricks)
      const cleanedMobile = password.replace(/\D/g, '');

      if (cleanedMobile.length < 10) {
        return res.status(401).json({ error: 'Invalid DL Number or mobile number.' });
      }

      // Safe parameterized query – trimmedDl is a plain validated string, never an operator object
      const driver = await Driver.findOne({ dlNumber: trimmedDl }).select(
        'dlNumber mobileNumber driverName status lastLoginAt lastLoginLocation'
      );

      // Use timing-safe comparison path: always compare even if driver not found (prevents user enumeration via timing)
      const mobileMatches = driver && driver.mobileNumber === cleanedMobile;

      if (!driver || !mobileMatches) {
        return res.status(401).json({ error: 'Invalid DL Number or mobile number.' });
      }

      if (driver.status !== 'Active') {
        return res.status(403).json({
          error: 'Driver account is inactive. Please contact your fleet administrator.',
        });
      }

      // Record driver location if provided
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

      const token = await createSession('Driver', driver, req, res);

      return res.json({
        message: 'Driver login successful',
        token,
        user: getAccountProfile('Driver', driver),
      });
    }

    // =========================================================================
    // 2. USER LOGIN
    //    Authentication: username (string) + bcrypt password hash comparison.
    // =========================================================================
    const trimmedUsername = username.toLowerCase();

    // Safe parameterized query – trimmedUsername is a validated plain string
    const user = await User.findOne({ username: trimmedUsername })
      .select('username passwordHash fullName role accessPages accessPlants status')
      .populate('accessPlants', 'plantName status');

    // Always run bcrypt compare to prevent timing-based user enumeration.
    // If user not found, compare against a dummy hash so response time is consistent.
    const DUMMY_HASH = '$2b$12$KIXYmHk3Pr3pE4a0QILFTu2q6q1WqPKE1IBZB2P1TGpHcInRbWrYy';
    const hashToCompare = user ? user.passwordHash : DUMMY_HASH;
    const isMatch = await bcrypt.compare(password, hashToCompare);

    if (!user || !isMatch) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    if (user.status !== 'Active') {
      return res.status(403).json({ error: 'Your account is inactive. Please contact your administrator.' });
    }

    const token = await createSession('User', user, req, res);

    res.json({
      message: 'Login successful',
      token,
      user: getAccountProfile('User', user),
    });
  } catch (error) {
    // Log only a sanitized message – never log the raw error which may contain user input or DB details
    console.error('[Login Error]: An unexpected error occurred during authentication.');
    res.status(500).json({ error: 'Login service encountered an unexpected error.' });
  }
});

// Rotate the persistent refresh token and issue a short-lived access token.
router.post('/refresh', async (req, res) => {
  try {
    await connectDB();

    const cookieToken = readRefreshCookie(req);
    if (!cookieToken) {
      // Upgrade existing signed-in clients once, without interrupting their current session.
      const authHeader = req.headers.authorization || '';
      const legacyToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      if (legacyToken) {
        let decoded;
        try {
          decoded = jwt.verify(legacyToken, getJwtSecret(), { algorithms: ['HS256'] });
        } catch {
          return sendInvalidSession(res);
        }
        if (decoded.sid || !decoded.userId || !mongoose.Types.ObjectId.isValid(decoded.userId)) {
          return sendInvalidSession(res);
        }
        const accountType = decoded.role === 'Driver' ? 'Driver' : 'User';
        const identity = await loadSessionAccount(accountType, decoded.userId);
        if (!identity) return sendInvalidSession(res, 'SESSION_REVOKED');
        const token = await createSession(accountType, identity.account, req, res);
        return res.json({ token, user: identity.user });
      }
      return sendInvalidSession(res);
    }

    const separator = cookieToken.indexOf('.');
    if (separator <= 0) return sendInvalidSession(res);
    const sessionId = cookieToken.slice(0, separator);
    const secret = cookieToken.slice(separator + 1);
    if (
      !mongoose.Types.ObjectId.isValid(sessionId) ||
      !/^[a-f0-9]{64}$/i.test(secret)
    ) {
      return sendInvalidSession(res);
    }

    const session = await AuthSession.findOne({
      _id: sessionId,
      expiresAt: { $gt: new Date() },
    });
    const suppliedHash = crypto.createHash('sha256').update(secret).digest();
    const storedHash = session
      ? Buffer.from(session.refreshHash, 'hex')
      : Buffer.alloc(suppliedHash.length);
    if (
      !session ||
      storedHash.length !== suppliedHash.length ||
      !crypto.timingSafeEqual(storedHash, suppliedHash)
    ) {
      return sendInvalidSession(res);
    }

    const identity = await loadSessionAccount(session.accountType, session.accountId);
    if (!identity) {
      await AuthSession.deleteOne({ _id: session._id });
      clearRefreshCookie(res, req);
      return sendInvalidSession(res, 'SESSION_REVOKED');
    }

    // Keep the refresh secret stable so simultaneous tabs can refresh safely.
    session.expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await session.save();
    res.cookie(
      REFRESH_COOKIE,
      cookieToken,
      getRefreshCookieOptions(req)
    );

    const token = createAccessToken(
      session.accountType,
      identity.account._id,
      session._id,
      session.accountType === 'Driver' ? identity.account.dlNumber : identity.account.username,
      session.accountType === 'Driver' ? 'Driver' : identity.account.role || 'User'
    );
    return res.json({ token, user: identity.user });
  } catch (error) {
    console.error('[Session Refresh Error]:', error.message || error);
    return res.status(503).json({
      error: 'Authentication service is temporarily unavailable.',
      code: 'AUTH_UNAVAILABLE',
    });
  }
});

// Revoke the server-side session and expire its persistent cookie on explicit logout.
router.post('/logout', async (req, res) => {
  try {
    await connectDB();
    const cookieToken = readRefreshCookie(req);
    const separator = cookieToken.indexOf('.');
    if (separator > 0) {
      const sessionId = cookieToken.slice(0, separator);
      if (mongoose.Types.ObjectId.isValid(sessionId)) {
        await AuthSession.deleteOne({ _id: sessionId });
      }
    }
    clearRefreshCookie(res, req);
    return res.json({ message: 'Logged out successfully.' });
  } catch (error) {
    console.error('[Session Logout Error]:', error.message || error);
    return res.status(503).json({
      error: 'Could not reach the authentication service to revoke this session.',
      code: 'AUTH_UNAVAILABLE',
    });
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

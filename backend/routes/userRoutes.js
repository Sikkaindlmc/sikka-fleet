const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { verifyToken, checkPageAccess } = require('../middleware/auth');

const router = express.Router();

// Require authenticated user with 'User Management' page permission
router.use(verifyToken, checkPageAccess('User Management'));

const SYSTEM_PAGES = [
  'Dashboard',
  'Plant',
  'Vehicle Register',
  'Driver Registry',
  'GPS',
  'Report',
  'User Management',
];

// GET /api/users/pages - Get list of system pages for access management
router.get('/pages', async (req, res) => {
  res.json({ pages: SYSTEM_PAGES });
});

// GET /api/users - List all users
router.get('/', async (req, res) => {
  try {
    const users = await User.find()
      .select('-passwordHash')
      .populate('accessPlants', 'plantName location status')
      .sort({ createdAt: -1 });

    // Ensure Admin users always reflect all system pages in their accessPages list
    const mappedUsers = users.map((u) => {
      const userObj = u.toObject();
      if (userObj.role === 'Admin') {
        const pageSet = new Set([...(userObj.accessPages || []), ...SYSTEM_PAGES]);
        userObj.accessPages = Array.from(pageSet);
      }
      return userObj;
    });

    res.json(mappedUsers);
  } catch (error) {
    console.error('[Get Users Error]:', error);
    res.status(500).json({ error: 'Failed to retrieve users.' });
  }
});

// POST /api/users - Create new user
router.post('/', async (req, res) => {
  try {
    const { fullName, username, role, password, confirmPassword, accessPlants, accessPages, status } = req.body;

    if (!fullName || !fullName.trim()) {
      return res.status(400).json({ error: 'Full Name is required.' });
    }
    if (!username || !username.trim()) {
      return res.status(400).json({ error: 'Username is required.' });
    }
    if (!password) {
      return res.status(400).json({ error: 'Password is required.' });
    }
    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match.' });
    }

    const trimmedUsername = username.trim().toLowerCase();

    // Prevent duplicate usernames
    const existing = await User.findOne({ username: trimmedUsername });
    if (existing) {
      return res.status(400).json({ error: `Username '${trimmedUsername}' is already taken.` });
    }

    const userRole = role === 'Admin' ? 'Admin' : 'User';

    // If Admin, grant all system pages automatically
    let finalPages = SYSTEM_PAGES;
    if (userRole !== 'Admin') {
      if (Array.isArray(accessPages) && accessPages.length > 0) {
        // Accept valid string pages (allows current SYSTEM_PAGES and any future added pages)
        finalPages = accessPages.filter((p) => typeof p === 'string' && p.trim().length > 0);
      } else {
        finalPages = ['Dashboard'];
      }
    }

    if (finalPages.length === 0) {
      return res.status(400).json({ error: 'At least one valid access page is required.' });
    }

    // Hash password with bcrypt
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const newUser = await User.create({
      fullName: fullName.trim(),
      username: trimmedUsername,
      role: userRole,
      passwordHash,
      accessPlants: Array.isArray(accessPlants) ? accessPlants : [],
      accessPages: finalPages,
      status: status === 'Inactive' ? 'Inactive' : 'Active',
    });

    const populatedUser = await User.findById(newUser._id)
      .select('-passwordHash')
      .populate('accessPlants', 'plantName location status');

    res.status(201).json({
      message: 'User created successfully.',
      user: populatedUser,
    });
  } catch (error) {
    console.error('[Create User Error]:', error);
    res.status(500).json({ error: 'Failed to create user account.' });
  }
});

// PUT /api/users/:id - Edit user
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { fullName, username, password, confirmPassword, accessPlants, accessPages, status, role } = req.body;

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    if (!fullName || !fullName.trim()) {
      return res.status(400).json({ error: 'Full Name is required.' });
    }
    if (!username || !username.trim()) {
      return res.status(400).json({ error: 'Username is required.' });
    }

    const trimmedUsername = username.trim().toLowerCase();

    // Duplicate check
    const duplicate = await User.findOne({
      _id: { $ne: id },
      username: trimmedUsername,
    });
    if (duplicate) {
      return res.status(400).json({ error: `Username '${trimmedUsername}' is already taken.` });
    }

    // If updating password
    if (password) {
      if (password !== confirmPassword) {
        return res.status(400).json({ error: 'Passwords do not match.' });
      }
      const salt = await bcrypt.genSalt(10);
      user.passwordHash = await bcrypt.hash(password, salt);
    }

    if (role && ['Admin', 'User'].includes(role)) {
      user.role = role;
    }

    // If user is Admin, they get all system pages
    if (user.role === 'Admin') {
      const pageSet = new Set([...(user.accessPages || []), ...SYSTEM_PAGES, ...(Array.isArray(accessPages) ? accessPages : [])]);
      user.accessPages = Array.from(pageSet);
    } else if (Array.isArray(accessPages)) {
      const finalPages = accessPages.filter((p) => typeof p === 'string' && p.trim().length > 0);
      if (finalPages.length > 0) {
        user.accessPages = finalPages;
      }
    }

    if (Array.isArray(accessPlants)) {
      user.accessPlants = accessPlants;
    }

    user.fullName = fullName.trim();
    user.username = trimmedUsername;
    user.status = status === 'Inactive' ? 'Inactive' : 'Active';

    await user.save();

    const populatedUser = await User.findById(user._id)
      .select('-passwordHash')
      .populate('accessPlants', 'plantName location status');

    res.json({
      message: 'User updated successfully.',
      user: populatedUser,
    });
  } catch (error) {
    console.error('[Update User Error]:', error);
    res.status(500).json({ error: 'Failed to update user account.' });
  }
});

// PATCH /api/users/:id/status - Quick activate / deactivate toggle
router.patch('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['Active', 'Inactive'].includes(status)) {
      return res.status(400).json({ error: 'Status must be Active or Inactive.' });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    user.status = status;
    await user.save();

    res.json({
      message: `User ${status === 'Active' ? 'activated' : 'deactivated'} successfully.`,
      user: {
        _id: user._id,
        status: user.status,
      },
    });
  } catch (error) {
    console.error('[Toggle User Status Error]:', error);
    res.status(500).json({ error: 'Failed to change user status.' });
  }
});

module.exports = router;


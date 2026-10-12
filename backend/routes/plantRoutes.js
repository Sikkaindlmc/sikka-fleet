const express = require('express');
const Plant = require('../models/Plant');
const { verifyToken, checkPageAccess } = require('../middleware/auth');
const { escapeRegex, isValidObjectId } = require('../utils/security');

const router = express.Router();

// Require authenticated user with 'Plant' page permission
router.use(verifyToken, checkPageAccess('Plant'));

// GET /api/plants - List all plants
router.get('/', async (req, res) => {
  try {
    const query = {};

    // If user has restricted plant permissions, restrict results
    if (req.user.accessPlants && req.user.accessPlants.length > 0) {
      const allowedPlantIds = req.user.accessPlants.map((p) => p._id || p);
      query._id = { $in: allowedPlantIds };
    }

    const plants = await Plant.find(query).sort({ createdAt: -1 });
    res.json(plants);
  } catch (error) {
    console.error('[Get Plants Error]:', error);
    res.status(500).json({ error: 'Failed to retrieve plants.' });
  }
});

// POST /api/plants - Create plant
router.post('/', async (req, res) => {
  try {
    const { plantName, location, radiusMeter, radiusMeters, latitude, longitude, status } = req.body;

    // Validation
    if (!plantName || !plantName.trim()) {
      return res.status(400).json({ error: 'Plant Name is required.' });
    }
    if (!location || !location.trim()) {
      return res.status(400).json({ error: 'Location is required.' });
    }
    const numRadius = Number(radiusMeters !== undefined ? radiusMeters : radiusMeter);
    if (isNaN(numRadius) || numRadius <= 0) {
      return res.status(400).json({ error: 'Radius must be a positive number greater than 0.' });
    }
    const numLat = Number(latitude);
    if (isNaN(numLat) || numLat < -90 || numLat > 90) {
      return res.status(400).json({ error: 'Latitude must be a valid coordinate between -90 and 90.' });
    }
    const numLon = Number(longitude);
    if (isNaN(numLon) || numLon < -180 || numLon > 180) {
      return res.status(400).json({ error: 'Longitude must be a valid coordinate between -180 and 180.' });
    }

    const plantStatus = status === 'Inactive' ? 'Inactive' : 'Active';

    // Duplicate prevention: do not allow duplicate active plant names
    if (plantStatus === 'Active') {
      const safeName = escapeRegex(plantName.trim());
      const existingActive = await Plant.findOne({
        plantName: { $regex: new RegExp(`^${safeName}$`, 'i') },
        status: 'Active',
      });
      if (existingActive) {
        return res.status(400).json({ error: `An active plant with name '${plantName.trim()}' already exists.` });
      }
    }

    const newPlant = await Plant.create({
      plantName: plantName.trim(),
      location: location.trim(),
      radiusMeters: numRadius,
      radiusMeter: numRadius,
      latitude: numLat,
      longitude: numLon,
      status: plantStatus,
    });

    res.status(201).json({
      message: 'Plant created successfully',
      plant: newPlant,
    });
  } catch (error) {
    console.error('[Create Plant Error]:', error);
    res.status(500).json({ error: 'Failed to create plant.' });
  }
});

// PUT /api/plants/:id - Edit plant
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid plant ID format.' });
    }

    // Authorization check for plant access if restricted
    if (req.user.role !== 'Admin' && req.user.accessPlants && req.user.accessPlants.length > 0) {
      const allowedIds = req.user.accessPlants.map((p) => (p._id ? p._id.toString() : p.toString()));
      if (!allowedIds.includes(id.toString())) {
        return res.status(403).json({ error: 'Access Denied: You do not have authorization to edit this plant.' });
      }
    }

    const { plantName, location, radiusMeter, radiusMeters, latitude, longitude, status } = req.body;

    const plant = await Plant.findById(id);
    if (!plant) {
      return res.status(404).json({ error: 'Plant record not found.' });
    }

    if (!plantName || !plantName.trim()) {
      return res.status(400).json({ error: 'Plant Name is required.' });
    }
    if (!location || !location.trim()) {
      return res.status(400).json({ error: 'Location is required.' });
    }
    const numRadius = Number(radiusMeters !== undefined ? radiusMeters : radiusMeter);
    if (isNaN(numRadius) || numRadius <= 0) {
      return res.status(400).json({ error: 'Radius must be a positive number greater than 0.' });
    }
    const numLat = Number(latitude);
    if (isNaN(numLat) || numLat < -90 || numLat > 90) {
      return res.status(400).json({ error: 'Latitude must be between -90 and 90.' });
    }
    const numLon = Number(longitude);
    if (isNaN(numLon) || numLon < -180 || numLon > 180) {
      return res.status(400).json({ error: 'Longitude must be between -180 and 180.' });
    }

    const plantStatus = status === 'Inactive' ? 'Inactive' : 'Active';

    // Duplicate check if active
    if (plantStatus === 'Active') {
      const safeName = escapeRegex(plantName.trim());
      const duplicate = await Plant.findOne({
        _id: { $ne: id },
        plantName: { $regex: new RegExp(`^${safeName}$`, 'i') },
        status: 'Active',
      });
      if (duplicate) {
        return res.status(400).json({ error: `An active plant with name '${plantName.trim()}' already exists.` });
      }
    }

    plant.plantName = plantName.trim();
    plant.location = location.trim();
    plant.radiusMeters = numRadius;
    plant.radiusMeter = numRadius;
    plant.latitude = numLat;
    plant.longitude = numLon;
    plant.status = plantStatus;
    plant.markModified('radiusMeters');
    plant.markModified('radiusMeter');

    await plant.save();

    res.json({
      message: 'Plant updated successfully',
      plant,
    });
  } catch (error) {
    console.error('[Update Plant Error]:', error);
    res.status(500).json({ error: 'Failed to update plant.' });
  }
});

module.exports = router;

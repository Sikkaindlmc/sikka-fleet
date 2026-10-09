const express = require('express');
const PlanNotification = require('../models/PlanNotification');
const VehicleCurrentStatus = require('../models/VehicleCurrentStatus');
const Vehicle = require('../models/Vehicle');
const Plant = require('../models/Plant');
const { verifyToken } = require('../middleware/auth');
const { getReadableLocation } = require('../services/locationHelper');

const router = express.Router();

// Require authenticated user for all notification endpoints
router.use(verifyToken);

/**
 * Formats a Date object to Indian Standard Time (IST) format: DD-MM-YYYY, HH:mm:ss
 */
function formatISTDateTime(dateInput) {
  if (!dateInput) return '—';
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return '—';

  const formatter = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(d);
  const partMap = {};
  for (const p of parts) {
    partMap[p.type] = p.value;
  }

  // DD-MM-YYYY, HH:mm:ss
  return `${partMap.day}-${partMap.month}-${partMap.year}, ${partMap.hour}:${partMap.minute}:${partMap.second}`;
}

/**
 * Builds user plant access query filter
 */
function buildAccessFilter(req) {
  if (req.user.role === 'Admin') {
    return {};
  }
  if (Array.isArray(req.user.accessPlants) && req.user.accessPlants.length > 0) {
    const allowedPlantIds = req.user.accessPlants.map((p) => (p._id || p).toString());
    return {
      $or: [
        { plantId: { $in: allowedPlantIds } },
        { plantId: null },
      ],
    };
  }
  return {};
}

/**
 * One-time backfill helper: Seeds notifications from existing vehicle plans if collection is empty
 */
async function backfillExistingPlansIfNeeded() {
  try {
    const count = await PlanNotification.countDocuments();
    if (count > 0) return;

    const statusesWithPlans = await VehicleCurrentStatus.find({
      'plans.0': { $exists: true },
    }).populate('vehicleId currentPlantId');

    for (const statusDoc of statusesWithPlans) {
      if (!statusDoc.vehicleId || !Array.isArray(statusDoc.plans)) continue;
      const vNum = statusDoc.vehicleId.vehicleNumber;
      const pName = statusDoc.currentPlantId?.plantName || statusDoc.lastExitPlantName || 'Plant';
      let loc = statusDoc.readableLocation || statusDoc.location || 'Plant Location';

      for (const p of statusDoc.plans) {
        await PlanNotification.create({
          plantId: statusDoc.currentPlantId?._id || null,
          plantName: pName,
          vehicleId: statusDoc.vehicleId._id,
          vehicleNumber: vNum,
          planBy: p.authorName || 'Sikka Team',
          location: loc,
          latitude: statusDoc.latitude,
          longitude: statusDoc.longitude,
          planNote: p.planText,
          createdAt: p.createdAt || new Date(),
        });
      }
    }
  } catch (err) {
    console.error('[Notification Backfill Error]:', err.message);
  }
}

// Run backfill non-blocking on startup
backfillExistingPlansIfNeeded();

const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;

/**
 * Returns Date object representing 48 hours before current timestamp
 */
function get48HourCutoff() {
  return new Date(Date.now() - FORTY_EIGHT_HOURS_MS);
}

// GET /api/notifications - Get all plan notifications (within 48 hours, latest first)
router.get('/', async (req, res) => {
  try {
    const userIdStr = (req.user._id || req.user.id).toString();
    const cutoffDate = get48HourCutoff();

    // Auto-remove any records older than 48 hours from DB
    PlanNotification.deleteMany({ createdAt: { $lt: cutoffDate } }).catch((delErr) => {
      console.warn('[Auto-remove 48h stale notifications]:', delErr.message);
    });

    const accessFilter = buildAccessFilter(req);
    const filter = {
      ...accessFilter,
      createdAt: { $gte: cutoffDate },
    };

    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const notifications = await PlanNotification.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit);

    let unreadCount = 0;
    const formattedList = notifications.map((item) => {
      const isRead = Array.isArray(item.readBy) && item.readBy.some((r) => r.userId.toString() === userIdStr);
      if (!isRead) {
        unreadCount++;
      }

      return {
        id: item._id,
        plantId: item.plantId,
        plantName: item.plantName,
        vehicleId: item.vehicleId,
        vehicleNumber: item.vehicleNumber,
        planBy: item.planBy,
        location: item.location || 'Plant Location',
        latitude: item.latitude,
        longitude: item.longitude,
        planNote: item.planNote,
        createdAt: item.createdAt,
        formattedDateTime: formatISTDateTime(item.createdAt),
        isRead,
      };
    });

    res.json({
      success: true,
      count: formattedList.length,
      unreadCount,
      notifications: formattedList,
    });
  } catch (error) {
    console.error('[Get Notifications Error]:', error);
    res.status(500).json({ success: false, error: 'Failed to retrieve notifications.' });
  }
});

// GET /api/notifications/unread-count - Lightweight polling endpoint for unread count badge (strictly within 48h)
router.get('/unread-count', async (req, res) => {
  try {
    const cutoffDate = get48HourCutoff();
    const accessFilter = buildAccessFilter(req);

    // Find all notifications matching filter where readBy doesn't contain current userId and created within 48h
    const unreadCount = await PlanNotification.countDocuments({
      ...accessFilter,
      createdAt: { $gte: cutoffDate },
      'readBy.userId': { $ne: req.user._id || req.user.id },
    });

    res.json({
      success: true,
      unreadCount,
    });
  } catch (error) {
    console.error('[Unread Count Error]:', error);
    res.status(500).json({ success: false, error: 'Failed to retrieve unread count.' });
  }
});

// POST /api/notifications/:id/read - Mark single notification as read for current user
router.post('/:id/read', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id || req.user.id;

    const notification = await PlanNotification.findById(id);
    if (!notification) {
      return res.status(404).json({ success: false, error: 'Notification not found.' });
    }

    const alreadyRead = notification.readBy.some((r) => r.userId.toString() === userId.toString());
    if (!alreadyRead) {
      notification.readBy.push({
        userId,
        readAt: new Date(),
      });
      await notification.save();
    }

    res.json({
      success: true,
      message: 'Notification marked as read.',
      id,
    });
  } catch (error) {
    console.error('[Mark Read Error]:', error);
    res.status(500).json({ success: false, error: 'Failed to mark notification as read.' });
  }
});

// POST /api/notifications/read-all - Mark all notifications as read for current user
router.post('/read-all', async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const filter = buildAccessFilter(req);

    await PlanNotification.updateMany(
      {
        ...filter,
        'readBy.userId': { $ne: userId },
      },
      {
        $push: {
          readBy: {
            userId,
            readAt: new Date(),
          },
        },
      }
    );

    res.json({
      success: true,
      message: 'All notifications marked as read.',
    });
  } catch (error) {
    console.error('[Mark All Read Error]:', error);
    res.status(500).json({ success: false, error: 'Failed to mark all notifications as read.' });
  }
});

module.exports = router;

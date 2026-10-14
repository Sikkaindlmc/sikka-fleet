const express = require('express');
const PlanNotification = require('../models/PlanNotification');
const VehicleCurrentStatus = require('../models/VehicleCurrentStatus');
const Vehicle = require('../models/Vehicle');
const Plant = require('../models/Plant');
const { verifyToken } = require('../middleware/auth');
const { isValidObjectId } = require('../utils/security');
const { getReadableLocation } = require('../services/locationHelper');
const {
  cleanupExpiredPlans,
  TWELVE_HOURS_MS,
  TWENTY_FOUR_HOURS_MS,
  getPlanExpiresAt,
} = require('../utils/planHelper');

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
        const isNextTrip = p.planType === 'Next Trip Plan' || statusDoc.status === 'Outside' || pName === 'Outside';
        const planType = isNextTrip ? 'Next Trip Plan' : 'Add Plan';
        const pCreatedAt = p.createdAt || new Date();
        const pExpiresAt = p.expiresAt || getPlanExpiresAt(pCreatedAt, planType);

        // Skip seeding if already expired
        if (new Date() >= new Date(pExpiresAt)) continue;

        await PlanNotification.create({
          plantId: statusDoc.currentPlantId?._id || null,
          plantName: pName,
          vehicleId: statusDoc.vehicleId._id,
          vehicleNumber: vNum,
          planType,
          planBy: p.authorName || 'Sikka Team',
          location: loc,
          latitude: statusDoc.latitude,
          longitude: statusDoc.longitude,
          planNote: p.planText,
          createdAt: pCreatedAt,
          expiresAt: pExpiresAt,
        });
      }
    }
  } catch (err) {
    console.error('[Notification Backfill Error]:', err.message);
  }
}

// Run backfill non-blocking on startup
backfillExistingPlansIfNeeded();

/**
 * Returns Mongo query filter for notifications that are currently active (not expired).
 * - Add Plan: within 12 hours of createdAt
 * - Next Trip Plan: within 24 hours of createdAt
 */
function buildActiveNotificationFilter() {
  const now = new Date();
  const nowTime = now.getTime();
  const twelveHoursAgo = new Date(nowTime - TWELVE_HOURS_MS);
  const twentyFourHoursAgo = new Date(nowTime - TWENTY_FOUR_HOURS_MS);

  return {
    $or: [
      { expiresAt: { $gt: now } },
      {
        expiresAt: null,
        planType: 'Next Trip Plan',
        createdAt: { $gte: twentyFourHoursAgo },
      },
      {
        expiresAt: null,
        planType: 'Add Plan',
        createdAt: { $gte: twelveHoursAgo },
      },
      {
        expiresAt: null,
        planType: { $exists: false },
        plantName: 'Outside',
        createdAt: { $gte: twentyFourHoursAgo },
      },
      {
        expiresAt: null,
        planType: { $exists: false },
        plantName: { $ne: 'Outside' },
        createdAt: { $gte: twelveHoursAgo },
      },
    ],
  };
}

// GET /api/notifications - Get all active plan notifications (12h for Add Plan, 24h for Next Trip Plan)
router.get('/', async (req, res) => {
  try {
    const userIdStr = (req.user._id || req.user.id).toString();

    // Trigger non-blocking cleanup of expired records from DB
    cleanupExpiredPlans().catch((delErr) => {
      console.warn('[Auto-cleanup stale plan notifications]:', delErr.message);
    });

    const accessFilter = buildAccessFilter(req);
    const activeFilter = buildActiveNotificationFilter();
    const filter = {
      ...accessFilter,
      ...activeFilter,
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
        planType: item.planType || (item.plantName === 'Outside' ? 'Next Trip Plan' : 'Add Plan'),
        planBy: item.planBy,
        location: item.location || 'Plant Location',
        latitude: item.latitude,
        longitude: item.longitude,
        planNote: item.planNote,
        createdAt: item.createdAt,
        expiresAt: item.expiresAt,
        formattedDateTime: formatISTDateTime(item.createdAt),
        activityType: item.activityType || 'PLAN_CREATED',
        deletedBy: item.deletedBy || null,
        deletedByUsername: item.deletedByUsername || null,
        deletedAt: item.deletedAt || null,
        formattedDeletedAt: item.deletedAt ? formatISTDateTime(item.deletedAt) : null,
        planCreatedAt: item.planCreatedAt || item.createdAt,
        formattedPlanCreatedAt: formatISTDateTime(item.planCreatedAt || item.createdAt),
        planId: item.planId || null,
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

// GET /api/notifications/unread-count - Lightweight polling endpoint for unread count badge
router.get('/unread-count', async (req, res) => {
  try {
    const accessFilter = buildAccessFilter(req);
    const activeFilter = buildActiveNotificationFilter();

    // Find all active notifications matching filter where readBy doesn't contain current userId
    const unreadCount = await PlanNotification.countDocuments({
      ...accessFilter,
      ...activeFilter,
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
    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, error: 'Invalid notification ID format.' });
    }

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

const VehicleCurrentStatus = require('../models/VehicleCurrentStatus');
const PlanNotification = require('../models/PlanNotification');

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

/**
 * Returns duration in milliseconds based on plan type.
 * - 'Add Plan' (Plant vehicle plan): 12 Hours
 * - 'Next Trip Plan' (Outside vehicle plan): 24 Hours
 */
function getPlanDurationMs(planType = 'Add Plan') {
  return planType === 'Next Trip Plan' ? TWENTY_FOUR_HOURS_MS : TWELVE_HOURS_MS;
}

/**
 * Resolves whether a plan is 'Next Trip Plan' or 'Add Plan'
 */
function resolvePlanType(plan, fallbackType = 'Add Plan') {
  if (plan?.planType === 'Next Trip Plan' || plan?.planType === 'Add Plan') {
    return plan.planType;
  }
  if (plan?.plantName === 'Outside' || fallbackType === 'Next Trip Plan') {
    return 'Next Trip Plan';
  }
  return 'Add Plan';
}

/**
 * Calculates the exact expiry Date object for a plan.
 */
function getPlanExpiresAt(createdAt = new Date(), planType = 'Add Plan') {
  const createdDate = new Date(createdAt);
  const baseTime = isNaN(createdDate.getTime()) ? Date.now() : createdDate.getTime();
  const durationMs = getPlanDurationMs(planType);
  return new Date(baseTime + durationMs);
}

/**
 * Checks if a plan has exceeded its retention time:
 * - 'Add Plan': 12 hours from Added Date Time
 * - 'Next Trip Plan': 24 hours from Added Date Time
 */
function isPlanExpired(plan, fallbackType = 'Add Plan', now = Date.now()) {
  if (!plan) return true;

  // If explicit expiresAt timestamp is recorded, check against it
  if (plan.expiresAt) {
    const expTime = new Date(plan.expiresAt).getTime();
    if (!isNaN(expTime)) {
      return now >= expTime;
    }
  }

  // Fallback to calculation based on createdAt and resolved plan type
  const type = resolvePlanType(plan, fallbackType);
  const durationMs = getPlanDurationMs(type);

  const createdTime = plan.createdAt ? new Date(plan.createdAt).getTime() : 0;
  if (!createdTime || isNaN(createdTime)) {
    return false;
  }

  return now - createdTime >= durationMs;
}

/**
 * Filters an array of plans to retain only active (non-expired) plans.
 */
function filterActivePlans(plans, fallbackType = 'Add Plan', now = Date.now()) {
  if (!Array.isArray(plans)) return [];
  return plans.filter((p) => !isPlanExpired(p, fallbackType, now));
}

/**
 * Clean up expired plans from both VehicleCurrentStatus documents and PlanNotification collection.
 * Auto-removes:
 * - Add Plan after 12 Hours from Added Date Time
 * - Next Trip Plan after 24 Hours from Added Date Time
 */
async function cleanupExpiredPlans() {
  const now = new Date();
  const nowTime = now.getTime();
  const twelveHoursAgo = new Date(nowTime - TWELVE_HOURS_MS);
  const twentyFourHoursAgo = new Date(nowTime - TWENTY_FOUR_HOURS_MS);

  let cleanedStatusesCount = 0;
  let cleanedNotifsCount = 0;

  try {
    // 1. Clean up PlanNotification collection
    const notifResult = await PlanNotification.deleteMany({
      $or: [
        // A) Expired via expiresAt timestamp
        { expiresAt: { $lte: now } },

        // B) Next Trip Plan created more than 24 hours ago
        {
          planType: 'Next Trip Plan',
          createdAt: { $lt: twentyFourHoursAgo },
        },

        // C) Add Plan created more than 12 hours ago
        {
          planType: 'Add Plan',
          createdAt: { $lt: twelveHoursAgo },
        },

        // D) Legacy outside plans without planType older than 24 hours
        {
          planType: { $exists: false },
          plantName: 'Outside',
          createdAt: { $lt: twentyFourHoursAgo },
        },

        // E) Legacy inside/plant plans without planType older than 12 hours
        {
          planType: { $exists: false },
          plantName: { $ne: 'Outside' },
          createdAt: { $lt: twelveHoursAgo },
        },
      ],
    });

    cleanedNotifsCount = notifResult.deletedCount || 0;

    // 2. Clean up VehicleCurrentStatus.plans array
    const statusesWithPlans = await VehicleCurrentStatus.find({
      'plans.0': { $exists: true },
    });

    for (const st of statusesWithPlans) {
      if (!Array.isArray(st.plans) || st.plans.length === 0) continue;

      const fallbackType = st.status === 'Outside' ? 'Next Trip Plan' : 'Add Plan';
      const activePlans = st.plans.filter((p) => !isPlanExpired(p, fallbackType, nowTime));

      if (activePlans.length !== st.plans.length) {
        await VehicleCurrentStatus.updateOne(
          { _id: st._id },
          { $set: { plans: activePlans } }
        );
        cleanedStatusesCount++;
      }
    }

    if (cleanedNotifsCount > 0 || cleanedStatusesCount > 0) {
      console.log(
        `[Plan Cleanup Service] Cleaned ${cleanedNotifsCount} expired notifications and updated ${cleanedStatusesCount} vehicle status docs.`
      );
    }
  } catch (err) {
    console.error('[Plan Cleanup Service Error]:', err.message);
  }

  return {
    cleanedNotifsCount,
    cleanedStatusesCount,
  };
}

module.exports = {
  TWELVE_HOURS_MS,
  TWENTY_FOUR_HOURS_MS,
  getPlanDurationMs,
  resolvePlanType,
  getPlanExpiresAt,
  isPlanExpired,
  filterActivePlans,
  cleanupExpiredPlans,
};

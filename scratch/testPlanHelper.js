const assert = require('assert');
const {
  TWELVE_HOURS_MS,
  TWENTY_FOUR_HOURS_MS,
  getPlanDurationMs,
  resolvePlanType,
  getPlanExpiresAt,
  isPlanExpired,
  filterActivePlans,
} = require('../backend/utils/planHelper');

console.log('--- Testing planHelper logic ---');

// 1. Duration check
assert.strictEqual(getPlanDurationMs('Add Plan'), 12 * 60 * 60 * 1000);
assert.strictEqual(getPlanDurationMs('Next Trip Plan'), 24 * 60 * 60 * 1000);
console.log('✓ Duration calculation verified: Add Plan = 12h, Next Trip Plan = 24h');

// 2. Type resolution check
assert.strictEqual(resolvePlanType({ planType: 'Add Plan' }), 'Add Plan');
assert.strictEqual(resolvePlanType({ planType: 'Next Trip Plan' }), 'Next Trip Plan');
assert.strictEqual(resolvePlanType({ plantName: 'Outside' }), 'Next Trip Plan');
assert.strictEqual(resolvePlanType({}, 'Next Trip Plan'), 'Next Trip Plan');
assert.strictEqual(resolvePlanType({}, 'Add Plan'), 'Add Plan');
console.log('✓ Type resolution verified');

// 3. Expiration calculation
const baseTime = new Date('2026-10-14T10:00:00Z');
const expAddPlan = getPlanExpiresAt(baseTime, 'Add Plan');
const expNextTrip = getPlanExpiresAt(baseTime, 'Next Trip Plan');

assert.strictEqual(expAddPlan.toISOString(), new Date(baseTime.getTime() + 12 * 3600 * 1000).toISOString());
assert.strictEqual(expNextTrip.toISOString(), new Date(baseTime.getTime() + 24 * 3600 * 1000).toISOString());
console.log('✓ Expiry timestamps verified: +12h and +24h');

// 4. Expiration check with simulated time
const now = new Date('2026-10-14T20:00:00Z').getTime(); // 10 hours after baseTime

// Add Plan: 10h old -> NOT expired
assert.strictEqual(
  isPlanExpired({ createdAt: baseTime, planType: 'Add Plan' }, 'Add Plan', now),
  false
);

// Add Plan: 13h old -> EXPIRED
const time13hAfter = new Date('2026-10-14T23:00:00Z').getTime();
assert.strictEqual(
  isPlanExpired({ createdAt: baseTime, planType: 'Add Plan' }, 'Add Plan', time13hAfter),
  true
);

// Next Trip Plan: 13h old -> NOT expired (since valid for 24h)
assert.strictEqual(
  isPlanExpired({ createdAt: baseTime, planType: 'Next Trip Plan' }, 'Next Trip Plan', time13hAfter),
  false
);

// Next Trip Plan: 25h old -> EXPIRED
const time25hAfter = new Date('2026-10-15T11:00:00Z').getTime();
assert.strictEqual(
  isPlanExpired({ createdAt: baseTime, planType: 'Next Trip Plan' }, 'Next Trip Plan', time25hAfter),
  true
);
console.log('✓ Auto-removal conditions verified (12h for Add Plan, 24h for Next Trip Plan)');

// 5. Array filtering check
const testPlans = [
  { planText: 'Fresh Add Plan', createdAt: new Date(now - 2 * 3600 * 1000), planType: 'Add Plan' },
  { planText: 'Stale Add Plan (>12h)', createdAt: new Date(now - 14 * 3600 * 1000), planType: 'Add Plan' },
  { planText: 'Active Next Trip (18h old)', createdAt: new Date(now - 18 * 3600 * 1000), planType: 'Next Trip Plan' },
  { planText: 'Stale Next Trip (>24h)', createdAt: new Date(now - 26 * 3600 * 1000), planType: 'Next Trip Plan' },
];

const activeAddPlans = filterActivePlans(testPlans, 'Add Plan', now);
assert.strictEqual(activeAddPlans.length, 2); // Fresh Add Plan + Active Next Trip (18h < 24h)
assert.strictEqual(activeAddPlans[0].planText, 'Fresh Add Plan');
assert.strictEqual(activeAddPlans[1].planText, 'Active Next Trip (18h old)');
console.log('✓ filterActivePlans verified');

console.log('All tests passed successfully!');

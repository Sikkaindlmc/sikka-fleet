const express = require('express');
const SikkaAiAuditLog = require('../models/SikkaAiAuditLog');
const SikkaAiSyncCooldown = require('../models/SikkaAiSyncCooldown');
const { verifyToken } = require('../middleware/auth');
const { aiLimiter } = require('../middleware/rateLimiter');
const {
  executeToolCall,
  formatToolAnswer,
  getSuggestions,
  hasFuzzyKeyword,
  hashQuery,
  localize,
  resolveVehicleReference,
  recognizeQuestion,
  UNSUPPORTED_MESSAGE,
} = require('../services/sikkaAiService');

const router = express.Router();
const MAX_QUESTION_LENGTH = 1000;
const AI_SYNC_COOLDOWN_MS = 2 * 60 * 1000;
const AI_SYNC_COOLDOWN_KEY = 'gps-sync';

async function reserveAiSync(now = new Date()) {
  try {
    const reservation = await SikkaAiSyncCooldown.findOneAndUpdate(
      {
        key: AI_SYNC_COOLDOWN_KEY,
        $or: [
          { lastTriggeredAt: { $lte: new Date(now.getTime() - AI_SYNC_COOLDOWN_MS) } },
          { lastTriggeredAt: { $exists: false } },
        ],
      },
      { $set: { lastTriggeredAt: now } },
      { new: true, upsert: true }
    ).lean();
    return Boolean(reservation);
  } catch (error) {
    if (error.code === 11000) return false;
    throw error;
  }
}

function getVehicleChoiceQuestion(tool, vehicleNumber) {
  if (tool === 'get_vehicle_history') return `Where was ${vehicleNumber} yesterday?`;
  if (tool === 'get_daily_report') return `${vehicleNumber} daily GPS report yesterday`;
  if (tool === 'get_vehicle_movement') return `${vehicleNumber} movement history yesterday`;
  if (tool === 'get_plant_movements') return `${vehicleNumber} plant entry and exit history`;
  return `Where is ${vehicleNumber} now?`;
}

function requireSikkaFleetAccess(req, res, next) {
  if (req.user?.role === 'Admin' ||
      (Array.isArray(req.user?.accessPages) && req.user.accessPages.length > 0)) {
    return next();
  }
  return res.status(403).json({ error: 'You do not have access to Sikka Fleet pages.' });
}

router.use(verifyToken, requireSikkaFleetAccess);

router.post('/query', aiLimiter, async (req, res) => {
  const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
  if (!question || question.length > MAX_QUESTION_LENGTH) {
    return res.status(400).json({
      error: `Enter a question between 1 and ${MAX_QUESTION_LENGTH} characters.`,
    });
  }
  let intent;
  try {
    const asksOwnDriverStatus = (/\b(my|me|i am|i'm)\b|\bwhere am i\b/i.test(question)) &&
      /\b(location|status|plant|entry|exit|gps)\b/i.test(question);
    if (req.user.role === 'Driver' && !asksOwnDriverStatus) {
      return res.status(403).json({
        error: 'Driver accounts can use Sikka AI only for their own saved location and plant status.',
      });
    }
    intent = req.user.role === 'Driver'
      ? { tool: 'get_driver_status', args: {} }
      : await recognizeQuestion(question);
  } catch (error) {
    console.error('[Sikka AI] Intent recognition failed:', error.code || 'INTENT_RECOGNITION_FAILED');
    return res.status(500).json({ error: 'Sikka AI could not read the required Sikka Fleet data.' });
  }
  if (!intent.suggestions && hasFuzzyKeyword(question)) {
    intent.suggestions = getSuggestions(intent.language, intent.args?.vehicleNumber || null);
  }
  const requestsSync = intent.tool === 'sync_gps_now' ||
    intent.tool === 'sync_then_location' ||
    Boolean(intent.liveQuery && req.user.role === 'Admin');
  const audit = new SikkaAiAuditLog({
    userId: req.user._id,
    username: req.user.username || '',
    action: requestsSync ? 'GPS_SYNC' : 'QUERY',
    queryHash: hashQuery(question),
  });

  try {
    await audit.save();
    if (requestsSync && req.user.role !== 'Admin') {
      audit.status = 'DENIED';
      audit.errorCode = 'ADMIN_REQUIRED';
      audit.completedAt = new Date();
      await audit.save();
      return res.status(403).json({ error: 'Only administrators can start GPS synchronization from Sikka AI.' });
    }
    audit.toolNames = [intent.tool];
    if (intent.tool === 'unsupported') {
      const answer = req.user.role === 'Driver'
        ? 'For privacy, SIKKA AI can only show your own saved driver location and plant status.'
        : localize(
            intent.language,
            UNSUPPORTED_MESSAGE,
            'मैं केवल Sikka Fleet के वाहन, GPS, प्लांट, रिपोर्ट और sync से जुड़े सवालों में मदद कर सकता हूँ।',
            'Main sirf Sikka Fleet vehicles, GPS, plants, reports aur sync ke sawaalon mein madad kar sakta hoon.'
          );
      audit.status = 'SUCCESS';
      audit.completedAt = new Date();
      await audit.save();
      return res.json({
        answer,
        suggestions: intent.suggestions || getSuggestions(intent.language),
        results: [{ tool: 'unsupported', data: { message: answer } }],
      });
    }

    if (intent.tool === 'clarify_date') {
      const noMarker = question.replace(/\bkal\b/ig, '').replace(/कल/g, '').trim();
      const suggestions = [
        `${noMarker} yesterday`.trim(),
        `${noMarker} tomorrow`.trim(),
      ];
      const answer = localize(
        intent.language,
        'Do you mean yesterday or tomorrow?',
        'क्या आपका मतलब बीता हुआ कल है या आने वाला कल?',
        'Aapka matlab yesterday hai ya tomorrow?'
      );
      audit.status = 'SUCCESS';
      audit.completedAt = new Date();
      await audit.save();
      return res.json({ answer, suggestions, results: [] });
    }

    if (intent.args?.vehicleNumber) {
      const resolution = await resolveVehicleReference(intent.args.vehicleNumber);
      if (resolution.status === 'ambiguous') {
        const suggestions = resolution.candidates.map((vehicle) =>
          getVehicleChoiceQuestion(intent.tool, vehicle.vehicleNumber)
        );
        const answer = localize(
          intent.language,
          'More than one registered vehicle matches those digits. Choose one:',
          'इन अंकों से एक से अधिक registered vehicle मिले हैं। एक चुनें:',
          'In digits se ek se zyada registered vehicles mile hain. Ek choose karein:'
        );
        audit.status = 'SUCCESS';
        audit.completedAt = new Date();
        await audit.save();
        return res.json({ answer, suggestions, results: [] });
      }
    }

    const isExplicitSync = intent.tool === 'sync_gps_now' || intent.tool === 'sync_then_location';
    const shouldAutoSync = Boolean(intent.liveQuery && req.user.role === 'Admin' && !isExplicitSync);
    let syncResults = null;
    let syncCooldown = false;
    if (isExplicitSync || shouldAutoSync) {
      if (req.user.role !== 'Admin') {
        audit.status = 'DENIED';
        audit.errorCode = 'ADMIN_REQUIRED';
        audit.completedAt = new Date();
        await audit.save();
        return res.status(403).json({ error: 'Only administrators can start GPS synchronization from Sikka AI.' });
      }
      const reserved = await reserveAiSync();
      if (!reserved && isExplicitSync) {
        audit.status = 'DENIED';
        audit.errorCode = 'AI_SYNC_COOLDOWN';
        audit.completedAt = new Date();
        await audit.save();
        return res.status(429).json({ error: 'Sikka AI GPS sync is limited to once every two minutes. Please use the latest saved data or try again shortly.' });
      }
      if (!reserved) {
        syncCooldown = true;
      } else {
        try {
          syncResults = await executeToolCall({
            name: 'sync_gps_now',
            args: { provider: intent.args?.provider || null },
          }, req.user);
        } catch (syncError) {
          console.error('[Sikka AI] GPS sync did not return provider results:', syncError.code || 'SYNC_FAILED');
          syncResults = {
            wheelseye: { status: 'FAILED', totalVehicles: 0, successCount: 0, failedCount: 0 },
            fleetx: { status: 'FAILED', totalVehicles: 0, successCount: 0, failedCount: 0 },
          };
        }
      }
    }

    let data;
    if (isExplicitSync) {
      data = syncResults || {};
    } else {
      data = await executeToolCall({ name: intent.tool, args: intent.args }, req.user);
      if (syncResults) data.syncResults = syncResults;
      if (syncCooldown) data.aiSyncCooldown = true;
    }
    const results = [{ tool: intent.tool, data }];
    const providerResults = data.syncResults || (isExplicitSync ? data : null);
    const providerStatuses = providerResults ? Object.values(providerResults).map((provider) => provider.status || 'FAILED') : [];
    audit.status = providerStatuses.length && providerStatuses.every((status) => status === 'FAILED')
      ? 'FAILED'
      : providerStatuses.some((status) => status === 'FAILED' || status === 'PARTIAL')
        ? 'PARTIAL'
        : 'SUCCESS';
    audit.resultCount = [
      data.records,
      data.vehicles,
      data.reports,
      data.stoppages,
      data.location?.vehicles,
    ].reduce((count, items) => count + (Array.isArray(items) ? items.length : 0), 0);
    if (providerStatuses.length) audit.resultCount += Object.keys(providerResults).length;
    audit.completedAt = new Date();
    await audit.save();
    return res.json({
      answer: formatToolAnswer(results, intent.language),
      suggestions: intent.suggestions || [],
      results,
    });
  } catch (error) {
    audit.status = 'FAILED';
    audit.errorCode = error.code || 'AI_QUERY_FAILED';
    audit.completedAt = new Date();
    try {
      await audit.save();
    } catch (auditError) {
      console.error('[Sikka AI] Failed to save query audit status:', auditError.code || 'AUDIT_SAVE_FAILED');
    }

    const statusCode = error.code === 'ADMIN_REQUIRED' ? 403 : 500;
    if (statusCode === 500) console.error('[Sikka AI] Query failed:', error.code || 'AI_QUERY_FAILED');
    return res.status(statusCode).json({ error: 'Sikka AI could not complete the request. Please try again or contact your administrator.' });
  }
});

module.exports = router;

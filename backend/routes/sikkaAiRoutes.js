const express = require('express');
const { verifyToken } = require('../middleware/auth');
const Vehicle = require('../models/Vehicle');
const Driver = require('../models/Driver');
const Plant = require('../models/Plant');
const AiApprovalRequest = require('../models/AiApprovalRequest');
const AiAuditLog = require('../models/AiAuditLog');
const AiSyncLog = require('../models/AiSyncLog');
const AiChatHistory = require('../models/AiChatHistory');

// Date & Time formatting helpers
const formatISTDateOnly = (d) => {
  const istDate = new Date(new Date(d).getTime() + 5.5 * 3600 * 1000);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = String(istDate.getUTCDate()).padStart(2, '0');
  const month = months[istDate.getUTCMonth()];
  const year = istDate.getUTCFullYear();
  return `${day}-${month}-${year}`;
};

const formatISTTimeOnly = (d) => {
  const istDate = new Date(new Date(d).getTime() + 5.5 * 3600 * 1000);
  let h = istDate.getUTCHours();
  const m = String(istDate.getUTCMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 === 0 ? 12 : (h > 12 ? h - 12 : h);
  return `${String(h).padStart(2, '0')}:${m} ${ampm}`;
};

const {
  run30MinSync,
  performErrorVerificationAndRepair,
  processUserQuery,
  processAdminDecision,
  calculateVehiclePlantStay,
  getLiveVehicleLocation,
  getDriverLocationDetails,
  getCombinedVehicleAndDriver,
  getLastSyncTimestamp,
  getNextSyncTimestamp,
  recordAuditLog,
} = require('../services/sikkaAiService');

const router = express.Router();

/**
 * Middleware: Strictly block Driver access to Sikka AI (Section 9)
 * "Driver Login session mein Sikka AI display nahi hoga, chatbot/interface access nahi karega"
 */
const blockDriverAccess = (req, res, next) => {
  if (req.user && req.user.role === 'Driver') {
    return res.status(403).json({
      error: 'Access Restricted: Sikka AI is not available in Driver accounts.',
      code: 'DRIVER_AI_FORBIDDEN',
    });
  }
  next();
};

/**
 * Middleware: Strictly restrict administrative features to Admin accounts (Requirements 1, 2, 4, 20, 22, 25)
 */
const adminOnly = (req, res, next) => {
  if (req.user && req.user.role === 'Admin') {
    return next();
  }
  return res.status(403).json({
    error: 'Access Denied: This administrative AI feature is restricted to Administrator accounts only.',
    code: 'ADMIN_ONLY',
  });
};

// All Sikka AI endpoints require active user session and exclude Drivers
router.use(verifyToken, blockDriverAccess);

/**
 * GET /api/sikka-ai/status
 * Live status of 30-min auto-sync, scheduler, and health
 */
router.get('/status', async (req, res) => {
  try {
    const [vehiclesCount, driversCount, plantsCount, pendingApprovalsCount, latestSyncLog] = await Promise.all([
      Vehicle.countDocuments({ status: 'Active' }),
      Driver.countDocuments({ status: 'Active' }),
      Plant.countDocuments({ status: 'Active' }),
      AiApprovalRequest.countDocuments({ status: 'Pending' }),
      AiSyncLog.findOne().sort({ startedAt: -1 }),
    ]);

    const lastSync = getLastSyncTimestamp() || latestSyncLog?.completedAt || latestSyncLog?.startedAt || null;
    const nextSync = getNextSyncTimestamp() || (lastSync ? new Date(new Date(lastSync).getTime() + 1800 * 1000) : null);

    res.json({
      application: 'Sikka AI Intelligence Module',
      status: 'Operational',
      autoSyncIntervalMinutes: 30,
      activeVehicles: vehiclesCount,
      activeDrivers: driversCount,
      activePlants: plantsCount,
      pendingApprovals: pendingApprovalsCount,
      lastSync,
      nextSync,
      latestSyncSummary: latestSyncLog
        ? {
            syncId: latestSyncLog.syncId,
            status: latestSyncLog.status,
            vehiclesSuccess: latestSyncLog.vehiclesSuccess,
            vehiclesFailed: latestSyncLog.vehiclesFailed,
            driversSuccess: latestSyncLog.driversSuccess,
            driversFailed: latestSyncLog.driversFailed,
            failuresCount: latestSyncLog.failures?.length || 0,
            repairsCount: latestSyncLog.repairsPerformed?.length || 0,
            completedAt: latestSyncLog.completedAt,
          }
        : null,
      serverTime: new Date(),
    });
  } catch (error) {
    console.error('[Sikka AI Status Error]:', error);
    res.status(500).json({ error: 'Failed to retrieve Sikka AI status.' });
  }
});

/**
 * POST /api/sikka-ai/query
 * Natural language chat query engine
 */
router.post('/query', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'Query text is required.' });
    }

    const response = await processUserQuery({
      query,
      user: req.user,
    });

    // Store Question & Answer in 24-Hour Auto-Delete History
    try {
      const now = new Date();
      const questionDate = formatISTDateOnly(now);
      const questionTime = formatISTTimeOnly(now);
      const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // Exactly 24 hours per message

      const vehicleMatch = query.match(/[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{1,4}/i);
      const relevantVehicle =
        response.vehicleNumber ||
        response.data?.vehicleNumber ||
        (vehicleMatch ? vehicleMatch[0].toUpperCase() : null);
      const relevantDriver = response.driverName || response.data?.driverName || null;
      const relevantPlant = response.plantName || response.data?.plantName || null;

      const historyRecord = await AiChatHistory.create({
        userId: req.user._id || req.user.id,
        userName: req.user.fullName || req.user.name || 'User',
        username: req.user.username || req.user.email?.split('@')[0] || 'user',
        userRole: req.user.role || 'User',
        question: query.trim(),
        answer: response.reply || '',
        relevantVehicle,
        relevantDriver,
        relevantPlant,
        questionDate,
        questionTime,
        createdAt: now,
        expiresAt,
      });

      response.historyId = historyRecord._id;
      response.questionDate = questionDate;
      response.questionTime = questionTime;
      response.expiresAt = expiresAt;
    } catch (histErr) {
      console.error('[Sikka AI History Save Error]:', histErr);
    }

    res.json(response);
  } catch (error) {
    console.error('[Sikka AI Query Error]:', error);
    res.status(500).json({ error: error.message || 'Error processing AI query.' });
  }
});

/**
 * GET /api/sikka-ai/history
 * Retrieve Sikka AI Q&A history (24-hour auto-delete)
 * Privacy & Security Rules:
 * - Normal User: Own questions and answers only.
 * - Admin: All users' questions and answers.
 * - After 24 hours: Automatically expired and permanently deleted for everyone.
 */
router.get('/history', async (req, res) => {
  try {
    const now = new Date();
    const { search, userId, vehicle, driver, plant } = req.query;

    // Strict 24-Hour validity check: Never return records past their expiresAt
    const filter = {
      expiresAt: { $gt: now },
    };

    // User Privacy Restriction (Enforced at API level)
    if (req.user.role !== 'Admin') {
      filter.userId = req.user._id || req.user.id;
    } else {
      if (userId) {
        filter.userId = userId;
      }
    }

    if (vehicle && vehicle.trim()) {
      filter.relevantVehicle = new RegExp(vehicle.trim(), 'i');
    }
    if (driver && driver.trim()) {
      filter.relevantDriver = new RegExp(driver.trim(), 'i');
    }
    if (plant && plant.trim()) {
      filter.relevantPlant = new RegExp(plant.trim(), 'i');
    }

    if (search && search.trim()) {
      const sRegex = new RegExp(search.trim(), 'i');
      filter.$or = [
        { question: sRegex },
        { answer: sRegex },
        { userName: sRegex },
        { username: sRegex },
        { relevantVehicle: sRegex },
        { relevantDriver: sRegex },
        { relevantPlant: sRegex },
      ];
    }

    const records = await AiChatHistory.find(filter).sort({ createdAt: -1 }).limit(100);

    const enriched = records.map((r) => {
      const obj = r.toObject();
      const diffMs = Math.max(0, new Date(obj.expiresAt).getTime() - now.getTime());
      const hoursLeft = Math.floor(diffMs / (3600 * 1000));
      const minsLeft = Math.floor((diffMs % (3600 * 1000)) / (60 * 1000));
      obj.remainingMinutes = Math.floor(diffMs / 60000);
      obj.remainingTime = hoursLeft > 0 ? `${hoursLeft}h ${minsLeft}m remaining` : `${minsLeft}m remaining`;
      return obj;
    });

    res.json({
      totalCount: enriched.length,
      userRole: req.user.role,
      history: enriched,
    });
  } catch (error) {
    console.error('[Sikka AI History Error]:', error);
    res.status(500).json({ error: 'Failed to retrieve AI Q&A history.' });
  }
});

/**
 * DELETE /api/sikka-ai/history/:id
 * Delete a specific Q&A history record
 */
router.delete('/history/:id', async (req, res) => {
  try {
    const record = await AiChatHistory.findById(req.params.id);
    if (!record) {
      return res.status(404).json({ error: 'Q&A history record not found or already expired.' });
    }

    // Normal users can only delete their own
    if (req.user.role !== 'Admin' && record.userId.toString() !== (req.user._id || req.user.id).toString()) {
      return res.status(403).json({ error: 'Forbidden: You can only delete your own Q&A history.' });
    }

    await AiChatHistory.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Q&A history record deleted successfully.' });
  } catch (error) {
    console.error('[Sikka AI Delete History Error]:', error);
    res.status(500).json({ error: 'Failed to delete history record.' });
  }
});

/**
 * POST /api/sikka-ai/sync
 * Manually trigger permitted GPS & Driver sync (Section 10)
 */
router.post('/sync', async (req, res) => {
  try {
    const userName = req.user.fullName || req.user.username || 'User';
    const result = await run30MinSync(userName, 'Manual User Sync');

    res.json({
      message: 'Sikka AI GPS and Driver Location synchronization completed.',
      result,
    });
  } catch (error) {
    console.error('[Sikka AI Manual Sync Error]:', error);
    res.status(500).json({ error: error.message || 'Synchronization failed.' });
  }
});

/**
 * POST /api/sikka-ai/repair
 * Trigger automated error verification & safe repair (Requirements 4, 20)
 * Admin Only
 */
router.post('/repair', adminOnly, async (req, res) => {
  try {
    const userName = req.user.fullName || req.user.username || 'User';
    const result = await performErrorVerificationAndRepair(userName);

    res.json({
      message: 'Sikka AI Error Verification and Safe Repair executed successfully.',
      result,
    });
  } catch (error) {
    console.error('[Sikka AI Repair Error]:', error);
    res.status(500).json({ error: error.message || 'Repair execution failed.' });
  }
});

/**
 * GET /api/sikka-ai/sync-logs
 * 30-min auto-sync history and failure reports (Admin Only)
 */
router.get('/sync-logs', adminOnly, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 20;
    const logs = await AiSyncLog.find()
      .sort({ startedAt: -1 })
      .limit(limit)
      .select('-vehicleRecords -driverRecords');

    res.json(logs);
  } catch (error) {
    console.error('[Sikka AI Sync Logs Error]:', error);
    res.status(500).json({ error: 'Failed to retrieve sync logs.' });
  }
});

/**
 * GET /api/sikka-ai/sync-logs/:id
 * Detailed records of a specific sync cycle (Admin Only)
 */
router.get('/sync-logs/:id', adminOnly, async (req, res) => {
  try {
    const log = await AiSyncLog.findOne({
      $or: [{ syncId: req.params.id }, { _id: req.params.id }],
    });

    if (!log) {
      return res.status(404).json({ error: 'Sync log not found.' });
    }

    res.json(log);
  } catch (error) {
    console.error('[Sikka AI Sync Log Detail Error]:', error);
    res.status(500).json({ error: 'Failed to retrieve sync log detail.' });
  }
});

/**
 * GET /api/sikka-ai/errors
 * List of recent/active GPS sync failures (Admin Only)
 */
router.get('/errors', adminOnly, async (req, res) => {
  try {
    const recentLogs = await AiSyncLog.find().sort({ startedAt: -1 }).limit(10);
    const allFailures = [];

    for (const log of recentLogs) {
      if (Array.isArray(log.failures) && log.failures.length > 0) {
        for (const f of log.failures) {
          allFailures.push({
            syncId: log.syncId,
            syncTime: log.startedAt,
            ...f.toObject(),
          });
        }
      }
    }

    res.json({
      totalErrors: allFailures.length,
      errors: allFailures,
    });
  } catch (error) {
    console.error('[Sikka AI Errors Error]:', error);
    res.status(500).json({ error: 'Failed to retrieve GPS sync errors.' });
  }
});

/**
 * POST /api/sikka-ai/submit-approval-request
 * Submit sensitive action from Chat UI Action Preview Card into Admin Authorization Queue
 */
router.post('/submit-approval-request', async (req, res) => {
  try {
    const { previewData } = req.body;
    if (!previewData || !previewData.actionType) {
      return res.status(400).json({ error: 'Valid previewData is required to submit an approval request.' });
    }

    const {
      actionType,
      actionTitle,
      actionDescription,
      reason,
      affectedRecordType,
      affectedRecordId,
      affectedRecordLabel,
      currentValue,
      requestedNewValue,
      aiVerificationResult,
      aiRiskLevel,
    } = previewData;

    // Normalize risk level to schema enum: 'Low' | 'Medium' | 'High' | 'Critical'
    let normalizedRisk = 'High';
    if (aiRiskLevel) {
      const rLower = String(aiRiskLevel).toLowerCase();
      if (rLower === 'critical') normalizedRisk = 'Critical';
      else if (rLower === 'high') normalizedRisk = 'High';
      else if (rLower === 'medium') normalizedRisk = 'Medium';
      else if (rLower === 'low') normalizedRisk = 'Low';
    }

    const requestedByName = req.user.fullName || req.user.username || 'Fleet Operator';
    const requestedByUsername = req.user.username || '';
    const requestId = `APR-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;

    const approvalRequest = await AiApprovalRequest.create({
      requestId,
      requestedBy: req.user._id,
      requestedByName,
      requestedByUsername,
      actionType,
      actionTitle: actionTitle || `${actionType} Request`,
      actionDescription: actionDescription || `Request submitted by ${requestedByName}`,
      reason: reason || 'Submitted via Sikka AI Assistant Preview Confirmation',
      affectedRecordType: affectedRecordType || 'General Record',
      affectedRecordId: affectedRecordId || '',
      affectedRecordLabel: affectedRecordLabel || 'System Entity',
      currentValue: currentValue !== undefined ? currentValue : null,
      requestedNewValue: requestedNewValue !== undefined ? requestedNewValue : null,
      aiVerificationResult: aiVerificationResult || 'Strict Security Verification: Pending Administrator Authorization.',
      aiRiskLevel: normalizedRisk,
      status: 'Pending',
    });

    // Create Audit Log Entry
    await recordAuditLog({
      user: requestedByName,
      userId: req.user._id,
      userRole: req.user.role || 'User',
      actionType: 'SENSITIVE_REQUEST_SUBMITTED',
      reason: `Sensitive action request submitted to Admin Authorization Center (${requestId}): ${actionTitle}`,
      result: 'Pending Approval',
      aiVerification: aiVerificationResult || 'Submitted for Admin Authorization',
      metadata: {
        requestId,
        actionType,
        affectedRecordLabel,
        aiRiskLevel: normalizedRisk,
      },
    });

    res.json({
      success: true,
      requestId,
      approvalRequest,
      message: `Request ${requestId} submitted to Admin Authorization Center.`,
    });
  } catch (error) {
    console.error('[Sikka AI Submit Approval Error]:', error);
    res.status(500).json({ error: error.message || 'Failed to submit approval request.' });
  }
});

/**
 * GET /api/sikka-ai/approvals
 * Admin Approval Requests (Admin Only)
 */
router.get('/approvals', adminOnly, async (req, res) => {
  try {
    const { status } = req.query;
    const filter = status ? { status } : {};
    const requests = await AiApprovalRequest.find(filter).sort({ createdAt: -1 });

    res.json(requests);
  } catch (error) {
    console.error('[Sikka AI Approvals Error]:', error);
    res.status(500).json({ error: 'Failed to retrieve approval requests.' });
  }
});

/**
 * POST /api/sikka-ai/approvals/:id/decide
 * Admin Decision on Sensitive Action (Approve / Reject) (Admin Only)
 */
router.post('/approvals/:id/decide', adminOnly, async (req, res) => {
  try {
    const { decision, rejectionReason } = req.body;
    if (!decision || !['Approve', 'Reject'].includes(decision)) {
      return res.status(400).json({ error: 'Decision must be "Approve" or "Reject".' });
    }

    const result = await processAdminDecision(req.params.id, {
      decision,
      adminUser: req.user,
      rejectionReason,
    });

    res.json(result);
  } catch (error) {
    console.error('[Sikka AI Admin Decision Error]:', error);
    res.status(400).json({ error: error.message || 'Failed to process decision.' });
  }
});

/**
 * GET /api/sikka-ai/audit-logs
 * Complete Audit Trail (Admin Only)
 */
router.get('/audit-logs', adminOnly, async (req, res) => {
  try {
    const { actionType, result, search, limit = 50, page = 1 } = req.query;
    const filter = {};

    if (actionType && actionType !== 'ALL') {
      filter.actionType = actionType;
    }
    if (result && result !== 'ALL') {
      filter.result = result;
    }
    if (search) {
      filter.$or = [
        { actionId: new RegExp(search, 'i') },
        { user: new RegExp(search, 'i') },
        { vehicle: new RegExp(search, 'i') },
        { driver: new RegExp(search, 'i') },
        { plant: new RegExp(search, 'i') },
        { reason: new RegExp(search, 'i') },
      ];
    }

    const parsedLimit = Math.min(100, parseInt(limit, 10) || 50);
    const parsedPage = Math.max(1, parseInt(page, 10) || 1);
    const skip = (parsedPage - 1) * parsedLimit;

    const [logs, total] = await Promise.all([
      AiAuditLog.find(filter).sort({ timestamp: -1 }).skip(skip).limit(parsedLimit),
      AiAuditLog.countDocuments(filter),
    ]);

    res.json({
      logs,
      pagination: {
        total,
        page: parsedPage,
        limit: parsedLimit,
        totalPages: Math.ceil(total / parsedLimit),
      },
    });
  } catch (error) {
    console.error('[Sikka AI Audit Logs Error]:', error);
    res.status(500).json({ error: 'Failed to retrieve audit logs.' });
  }
});

module.exports = router;

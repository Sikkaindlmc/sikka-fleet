const express = require('express');
const Plant = require('../models/Plant');
const Vehicle = require('../models/Vehicle');
const Driver = require('../models/Driver');
const VehicleCurrentStatus = require('../models/VehicleCurrentStatus');
const PlantEntryEvent = require('../models/PlantEntryEvent');
const PlanNotification = require('../models/PlanNotification');
const GpsSetting = require('../models/GpsSetting');
const GpsSyncLog = require('../models/GpsSyncLog');
const { verifyToken, checkPageAccess } = require('../middleware/auth');
const {
  attachNearestDriversToVehicles,
  findNearestDriversForLocation,
} = require('../services/driverMatchingService');
const {
  calculateHaversineDistance,
  calculateStayDuration,
  getVehiclePlantStatus,
  getPlantRadiusMeters,
} = require('../services/geofenceService');
const { getReadableLocation } = require('../services/locationHelper');
const { resolveMovementStatus } = require('../services/telemetryValues');
const { getNextFixed30MinSlot } = require('../services/gpsCronWorker');
const { getFleetGpsSnapshot } = require('../services/gpsDataService');
const mongoose = require('mongoose');
const PlanAuditLog = require('../models/PlanAuditLog');
const { isValidObjectId, sanitizeText, maskUrlSecret } = require('../utils/security');
const { isGpsSchedulerRunning } = require('../services/gpsScheduler');
const { getGpsConnectionStatus } = require('../utils/gpsProvider');
const {
  filterActivePlans,
  getPlanExpiresAt,
  TWELVE_HOURS_MS,
  TWENTY_FOUR_HOURS_MS,
} = require('../utils/planHelper');

const router = express.Router();

function formatGpsTimeIST(value) {
  if (!value) return 'time unknown';
  return new Date(value).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function safeGpsErrorDetails(value) {
  if (!value) return '';
  return String(value)
    .replace(/https?:\/\/[^\s"'<>]+/gi, (url) => maskUrlSecret(url))
    .replace(/((?:access[_-]?token|api[_-]?key|token|secret|password)\s*[=:]\s*)["']?[^,\s"'&]+/gi, '$1[REDACTED]')
    .replace(/(Bearer\s+)\S+/gi, '$1[REDACTED]');
}

// Require authenticated user with 'Dashboard' page permission
router.use(verifyToken, checkPageAccess('Dashboard'));

// GET /api/dashboard/summary - Dynamic widgets for active plants and outside
router.get('/summary', async (req, res) => {
  try {
    // =========================================================================
    // DRIVER DASHBOARD ISOLATION (Requirements 12, 13, 18, 19, 23)
    // Driver sees ONLY own status, own plant/outside widget, own location
    // NEVER returns other vehicles or drivers.
    // =========================================================================
    if (req.user.role === 'Driver') {
      const Driver = require('../models/Driver');
      const { getDriverLocationSummary } = require('../services/driverLocationService');

      const driverId = req.user.id || req.user._id;
      const driver = await Driver.findById(driverId);
      if (!driver) {
        return res.status(404).json({ error: 'Driver account not found.' });
      }

      const driverSummary = await getDriverLocationSummary(driver);

      const plantWidgets = driverSummary.isInside && driverSummary.currentPlant
        ? [
            {
              id: driverSummary.currentPlant.id || 'current-plant',
              name: driverSummary.currentPlant.name,
              location: driverSummary.currentPlant.location || 'Configured Plant Radius',
              radiusMeter: driverSummary.currentPlant.radiusMeters ?? null,
              latitude: driverSummary.currentPlant.latitude,
              longitude: driverSummary.currentPlant.longitude,
              vehicleCount: 1,
              driverCount: 1,
              isOutside: false,
              inTime: driverSummary.inTime,
            },
          ]
        : [];

      const outsideWidget = driverSummary.isOutside
        ? {
            id: 'outside',
            name: 'Outside',
            vehicleCount: 1,
            driverCount: 1,
            isOutside: true,
            outTime: driverSummary.outTime,
          }
        : null;

      return res.json({
        isDriver: true,
        driverSummary,
        plantWidgets,
        outsideWidget,
        totalActiveVehicles: 1,
        lastUpdated: new Date(),
      });
    }

    const snapshot = await getFleetGpsSnapshot({ dashboardOnly: true });
    const allowedPlantIds = req.user.accessPlants && req.user.accessPlants.length > 0
      ? new Set(req.user.accessPlants.map((plant) => (plant._id ? plant._id.toString() : plant.toString())))
      : null;
    const plantWidgets = snapshot.plantWidgets
      .filter((plant) => !allowedPlantIds || allowedPlantIds.has(plant.id.toString()))
      .map((plant) => ({
        ...plant,
        vehicleCount: plant.vehicles.length,
        driverCount: new Set(plant.vehicles.map((item) => item.vehicle.driverName).filter(Boolean)).size,
        isOutside: false,
        vehicles: plant.vehicles.map((item) => ({
          vehicleNumber: item.vehicle.vehicleNumber,
          registrationStatus: item.isRegistered ? 'Registered' : 'Not registered',
          status: 'Inside',
          plantName: item.plant?.name || plant.name,
          entryDateTime: item.statusDetectedAt,
          lastUpdateDateTime: item.gpsTimestamp,
          stayHours: item.stayHours,
          gps_status: item.gpsStatus,
          last_sync_source: item.lastSyncType || item.storedStatus?.lastSyncType || item.storedStatus?.last_sync_source || null,
          gpsProviderLocations: item.providerLocations || [],
          locationDiscrepancyMeters: item.locationDiscrepancyMeters,
          providerUnavailable: item.providerUnavailable
            ? `${item.providerUnavailable.provider} unavailable; last known GPS fix ${formatGpsTimeIST(item.gpsTimestamp)} IST`
            : null,
        })),
      }));
    const outsideVehicles = snapshot.outsideVehicles.map((item) => ({
      vehicleNumber: item.vehicle.vehicleNumber,
      registrationStatus: item.isRegistered ? 'Registered' : 'Not registered',
      status: 'Outside',
      plantName: null,
      outsideSince: item.statusDetectedAt,
      outsideHours: item.outsideHours,
      lastUpdateDateTime: item.gpsTimestamp,
      gps_status: item.gpsStatus,
      last_sync_source: item.lastSyncType || item.storedStatus?.lastSyncType || item.storedStatus?.last_sync_source || null,
      gpsProviderLocations: item.providerLocations || [],
      locationDiscrepancyMeters: item.locationDiscrepancyMeters,
      providerUnavailable: item.providerUnavailable
        ? `${item.providerUnavailable.provider} unavailable; last known GPS fix ${formatGpsTimeIST(item.gpsTimestamp)} IST`
        : null,
    }));

    const setting = await GpsSetting.findOne({
      archived: { $ne: true },
      $or: [{ provider: /wheels.?eye/i }, { apiUrl: /wheelseye/i }],
    }).sort({ updatedAt: -1 });
    const lastSuccessfulSync = await GpsSyncLog.findOne({
      status: 'SUCCESS',
      provider: /wheels.?eye/i,
      archived: { $ne: true },
    }).sort({ completedAt: -1 });
    const latestSyncLog = await GpsSyncLog.findOne({
      provider: /wheels.?eye/i,
      archived: { $ne: true },
    }).sort({ startedAt: -1 });
    const lastFailedSync = await GpsSyncLog.findOne({
      status: 'FAILED',
      provider: /wheels.?eye/i,
      archived: { $ne: true },
    }).sort({ completedAt: -1, startedAt: -1 });
    const lastSuccessful = lastSuccessfulSync?.completedAt ||
      lastSuccessfulSync?.lastEvaluatedTimestamp ||
      setting?.last_evaluated_timestamp ||
      null;
    const lastEvaluated = lastSuccessful;
    const nextSync = getNextFixed30MinSlot(new Date());
    const syncStatus = latestSyncLog?.status || setting?.last_sync_status || 'IDLE';
    const activeProvider = setting;
    const providerSyncHealth = [{
      provider: 'WheelsEye GPS',
      status: getGpsConnectionStatus(setting, 'WheelsEye GPS'),
      lastSyncStatus: latestSyncLog?.status || setting?.last_sync_status || 'IDLE',
      lastSuccessfulSyncAt: lastSuccessful,
      lastFailedSyncAt: lastFailedSync?.completedAt || lastFailedSync?.startedAt || setting?.lastErrorAt || null,
      nextScheduledSyncAt: setting?.next_scheduled_sync_at || nextSync,
      vehiclesProcessed: latestSyncLog?.vehiclesProcessed ?? setting?.vehicles_processed ?? 0,
      vehiclesUpdated: latestSyncLog?.vehiclesUpdated ?? setting?.vehicles_updated ?? 0,
      registeredVehicleCount: snapshot.fleet.filter((item) => item.isRegistered).length,
      validGpsVehicleCount: snapshot.fleet.filter((item) =>
        item.isRegistered && item.providerLocations?.some((location) => location.hasGps)
      ).length,
      lastError: safeGpsErrorDetails(setting?.lastError || (latestSyncLog?.status === 'FAILED' ? latestSyncLog.errorMessage : '')),
    }];
    const schedulerMode = (process.env.GPS_SCHEDULER_MODE || 'github-actions').trim().toLowerCase();
    const schedulerStatus = schedulerMode === 'server'
      ? (isGpsSchedulerRunning() ? 'Running in backend' : 'Configured, not running')
      : schedulerMode === 'github-actions'
        ? 'External scheduler (GitHub Actions)'
        : 'Not configured';
    const rawLastError = activeProvider?.lastError ||
      (latestSyncLog?.status === 'FAILED' ? latestSyncLog.errorMessage : '');
    const authStatus = ['401', '403'].includes(String(activeProvider?.lastErrorCode || ''))
      ? String(activeProvider.lastErrorCode)
      : '';
    const lastErrorDetails = authStatus
      ? `HTTP ${authStatus}: WheelsEye rejected the configured GPS credential. Confirm that it is active and authorized for this endpoint with WheelsEye.`
      : safeGpsErrorDetails(rawLastError);

    res.json({
      plantWidgets,
      outsideWidget: {
        id: 'outside',
        name: 'Outside',
        vehicleCount: snapshot.outsideVehicles.length,
        driverCount: new Set(snapshot.outsideVehicles.map((item) => item.vehicle.driverName).filter(Boolean)).size,
        isOutside: true,
        vehicles: outsideVehicles,
      },
      totalActiveVehicles: snapshot.totalActiveVehicles,
      lastUpdated: lastEvaluated,
      last_evaluated_timestamp: lastEvaluated,
      last_successful_sync_at: lastSuccessful,
      next_scheduled_sync_at: nextSync,
      next_sync_timestamp: nextSync,
      last_sync_status: syncStatus,
      last_sync_source: latestSyncLog?.syncType || setting?.last_sync_source || null,
      last_failed_sync_at: lastFailedSync?.completedAt || lastFailedSync?.startedAt || activeProvider?.lastErrorAt || null,
      latest_sync_vehicles_updated: latestSyncLog?.vehiclesUpdated || 0,
      gps_sync_health: {
        schedulerMode,
        schedulerStatus,
        apiConnectionStatus: activeProvider?.connectionStatus || 'Not configured',
        lastSuccessfulSyncAt: lastSuccessful,
        lastFailedSyncAt: lastFailedSync?.completedAt || lastFailedSync?.startedAt || activeProvider?.lastErrorAt || null,
        latestSyncStatus: syncStatus,
        latestSyncVehiclesUpdated: latestSyncLog?.vehiclesUpdated || 0,
        lastApiError: lastErrorDetails,
        nextScheduledSyncAt: nextSync,
      },
      providerHealth: providerSettings.map((item) => ({
        provider: item.provider,
        active: item.status === 'Active',
        status: getGpsConnectionStatus(item, item.provider),
        lastSuccessAt: item.lastSuccessAt,
        lastErrorAt: item.lastErrorAt,
        lastErrorCode: item.lastErrorCode,
        lastError: safeGpsErrorDetails(item.lastError),
        consecutiveFailures: item.consecutiveFailures,
      })),
      gpsProviderSyncHealth: providerSyncHealth,
      autoSync: {
        status: schedulerStatus,
        intervalMinutes: 30,
        lastEvaluated,
        lastSuccessfulSyncAt: lastSuccessful,
        nextScheduledSyncAt: nextSync,
        nextSync,
      },
    });
  } catch (error) {
    console.error('[Dashboard Summary Error]:', error);
    res.status(500).json({ error: 'Failed to generate dashboard summary.' });
  }
});

// GET /api/dashboard/plants/:plantId/vehicles - Drilldown into vehicles inside a plant
router.get('/plants/:plantId/vehicles', async (req, res) => {
  try {
    if (req.user.role === 'Driver') {
      return res.status(403).json({ error: 'Access Denied: Drivers cannot view company fleet vehicles.' });
    }

    const { plantId } = req.params;
    if (!isValidObjectId(plantId)) {
      return res.status(400).json({ error: 'Invalid plant ID format.' });
    }

    // RBAC check: enforce plant access if user has restrictions
    if (req.user.accessPlants && req.user.accessPlants.length > 0) {
      const allowedPlantIds = req.user.accessPlants.map((p) => (p._id ? p._id.toString() : p.toString()));
      if (!allowedPlantIds.includes(plantId.toString())) {
        return res.status(403).json({ error: 'Access Denied: You do not have permission to view this plant.' });
      }
    }

    const plant = await Plant.findById(plantId);
    if (!plant) {
      return res.status(404).json({ error: 'Plant not found.' });
    }

    const snapshot = await getFleetGpsSnapshot({ dashboardOnly: true });
    const activePlants = snapshot.plants;
    const vehicles = snapshot.fleet
      .filter((item) => item.status === 'Inside' && item.plant?.id?.toString() === plantId)
      .map((item) => {
        const vehicle = item.vehicle;
        const status = item.storedStatus;
        const readableLoc = item.latitude !== null && item.longitude !== null
          ? getReadableLocation(item.latitude, item.longitude, activePlants)
          : 'N/A';
        return {
          id: vehicle._id || `gps-unregistered-${item.vehicle.vehicleNumber}`,
          vehicleId: vehicle._id,
          vehicleNumber: vehicle.vehicleNumber,
          registrationStatus: item.isRegistered ? 'Registered' : 'Not registered',
          driverName: vehicle.driverName,
          mobile: vehicle.mobile,
          fleetType: vehicle.fleetType,
          ownerName: vehicle.ownerName,
          plantName: item.plant?.name || plant.plantName,
          entryDateTime: item.statusDetectedAt,
          lastUpdateDateTime: item.gpsTimestamp,
          last_sync_source: item.lastSyncType || status?.lastSyncType || status?.last_sync_source || null,
          latitude: item.latitude,
          longitude: item.longitude,
          distanceMeter: item.distanceMeter,
          speed: item.speed,
          ignition: item.ignition,
          movementStatus: status?.movementStatus || null,
          dataCheck: false,
          status: 'Inside',
          location: readableLoc,
          readableLocation: readableLoc,
          latest_gps_timestamp: item.gpsTimestamp,
          gps_status: item.gpsStatus,
          gpsProviderLocations: item.providerLocations || [],
          locationDiscrepancyMeters: item.locationDiscrepancyMeters,
          stayHours: item.stayHours,
          plans: filterActivePlans(status?.plans, 'Add Plan'),
        };
      });

    // Attach nearest drivers within 100m based on GPS distance (Requirement 23)
    const vehiclesWithDrivers = await attachNearestDriversToVehicles(vehicles);

    // Available drivers within 100m of plant location (Requirement 23.4)
    let plantAvailableDrivers = [];
    if (typeof plant.latitude === 'number' && typeof plant.longitude === 'number') {
      const plantMatch = await findNearestDriversForLocation(plant.latitude, plant.longitude);
      plantAvailableDrivers = plantMatch.nearestDrivers;
    }

    res.json({
      plant: {
        id: plant._id,
        name: plant.plantName,
        location: plant.location,
        radiusMeter: getPlantRadiusMeters(plant),
        availableDrivers: plantAvailableDrivers,
      },
      vehicles: vehiclesWithDrivers,
    });
  } catch (error) {
    console.error('[Dashboard Plant Vehicles Error]:', error);
    res.status(500).json({ error: 'Failed to retrieve plant vehicle list.' });
  }
});

// GET /api/dashboard/plants/:plantId/drivers - Drilldown into drivers operating inside/at a plant
router.get('/plants/:plantId/drivers', async (req, res) => {
  try {
    if (req.user.role === 'Driver') {
      return res.status(403).json({ error: 'Access Denied: Drivers cannot view company fleet drivers.' });
    }

    const { plantId } = req.params;
    if (!isValidObjectId(plantId)) {
      return res.status(400).json({ error: 'Invalid plant ID format.' });
    }

    // RBAC check: enforce plant access if user has restrictions
    if (req.user.accessPlants && req.user.accessPlants.length > 0) {
      const allowedPlantIds = req.user.accessPlants.map((p) => (p._id ? p._id.toString() : p.toString()));
      if (!allowedPlantIds.includes(plantId.toString())) {
        return res.status(403).json({ error: 'Access Denied: You do not have permission to view this plant.' });
      }
    }

    const plant = await Plant.findById(plantId);
    if (!plant) {
      return res.status(404).json({ error: 'Plant not found.' });
    }

    // 1. Get vehicles currently inside this plant
    const currentStatuses = await VehicleCurrentStatus.find({
      currentPlantId: plantId,
      status: 'Inside',
    })
      .populate('vehicleId', 'vehicleNumber driverName mobile fleetType ownerName status')
      .sort({ lastEntryDateTime: -1 });

    const allRegisteredDrivers = await Driver.find({ status: 'Active' });
    const driversMap = new Map();

    // A) Drivers matched from vehicles inside this plant
    for (const st of currentStatuses) {
      if (!st.vehicleId || st.vehicleId.status !== 'Active') continue;
      const v = st.vehicleId;
      const dName = (v.driverName || '').trim();
      const dMobile = (v.mobile || '').trim();

      if (dName || dMobile) {
        const matchedDriver = allRegisteredDrivers.find(
          (d) =>
            (dMobile && d.mobileNumber === dMobile) ||
            (dName && d.driverName.toLowerCase() === dName.toLowerCase())
        );

        const key = dMobile || dName;
        const dLat = st.latitude || plant.latitude;
        const dLon = st.longitude || plant.longitude;
        const readableLoc = getReadableLocation(dLat, dLon, [plant]) || plant.location;

        driversMap.set(key, {
          id: matchedDriver ? matchedDriver._id : `veh-${v._id}`,
          driverName: matchedDriver ? matchedDriver.driverName : dName,
          mobileNumber: matchedDriver ? matchedDriver.mobileNumber : dMobile,
          dlNumber: matchedDriver ? matchedDriver.dlNumber : '—',
          photo: (matchedDriver && matchedDriver.photo) || null,
          vehicleNumber: v.vehicleNumber,
          status: 'Inside',
          plantName: plant.plantName,
          plantInTime: (matchedDriver && matchedDriver.currentPlantInTime) || st.lastEntryDateTime || st.createdAt || null,
          location: readableLoc,
          readableLocation: readableLoc,
          latitude: dLat,
          longitude: dLon,
          distanceMeters: Math.round(st.distanceMeter || 0),
          lastLocationAt:
            (matchedDriver && matchedDriver.lastLocationUpdateAt) ||
            st.lastEntryDateTime ||
            st.lastUpdatedAt,
          isStale: false,
        });
      }
    }

    // B) Registered drivers currently inside this plant by currentPlantId or GPS coordinates
    for (const d of allRegisteredDrivers) {
      const isInsideThisPlant =
        (d.currentPlantId && d.currentPlantId.toString() === plantId.toString()) ||
        (d.currentPlantName && d.currentPlantName.toLowerCase() === plant.plantName.toLowerCase());

      let distToPlant = Infinity;
      const curLat = (d.lastLocation && typeof d.lastLocation.latitude === 'number') ? d.lastLocation.latitude : d.lastLatitude;
      const curLon = (d.lastLocation && typeof d.lastLocation.longitude === 'number') ? d.lastLocation.longitude : d.lastLongitude;

      if (typeof curLat === 'number' && typeof curLon === 'number') {
        distToPlant = calculateHaversineDistance(
          curLat,
          curLon,
          plant.latitude,
          plant.longitude
        );
      }

      const plantRadius = getPlantRadiusMeters(plant);
      if (isInsideThisPlant || (plantRadius !== null && distToPlant <= plantRadius)) {
        const key = d.mobileNumber || d.driverName;
        if (!driversMap.has(key)) {
          const vehStatus = currentStatuses.find(
            (st) =>
              st.vehicleId &&
              ((st.vehicleId.mobile && st.vehicleId.mobile === d.mobileNumber) ||
                (st.vehicleId.driverName &&
                  st.vehicleId.driverName.toLowerCase() === d.driverName.toLowerCase()))
          );

          const dLat = typeof curLat === 'number' ? curLat : plant.latitude;
          const dLon = typeof curLon === 'number' ? curLon : plant.longitude;
          const readableLoc = getReadableLocation(dLat, dLon, [plant]) || plant.location;

          driversMap.set(key, {
            id: d._id,
            driverName: d.driverName,
            mobileNumber: d.mobileNumber,
            dlNumber: d.dlNumber,
            photo: d.photo || null,
            vehicleNumber: vehStatus?.vehicleId?.vehicleNumber || 'Unassigned',
            status: 'Inside',
            plantName: plant.plantName,
            plantInTime: d.currentPlantInTime || d.createdAt || null,
            location: readableLoc,
            readableLocation: readableLoc,
            latitude: dLat,
            longitude: dLon,
            distanceMeters: distToPlant !== Infinity ? Math.round(distToPlant) : 0,
            lastLocationAt: d.lastLocationUpdateAt || d.lastLoginAt,
            isStale: d.lastLocationUpdateAt
              ? Date.now() - new Date(d.lastLocationUpdateAt).getTime() > 25 * 60 * 1000
              : false,
          });
        }
      }
    }

    const drivers = Array.from(driversMap.values());

    res.json({
      title: `${plant.plantName} – Drivers`,
      plant: {
        id: plant._id,
        name: plant.plantName,
        location: plant.location,
        radiusMeter: getPlantRadiusMeters(plant),
      },
      drivers,
    });
  } catch (error) {
    console.error('[Dashboard Plant Drivers Error]:', error);
    res.status(500).json({ error: 'Failed to retrieve plant driver list.' });
  }
});

// POST /api/dashboard/vehicles/:vehicleId/plan - Add or edit dispatch plan for a vehicle
router.post('/vehicles/:vehicleId/plan', async (req, res) => {
  try {
    if (req.user.role === 'Driver') {
      return res.status(403).json({ error: 'Access Denied: Drivers cannot create or modify vehicle plans.' });
    }

    const { vehicleId } = req.params;
    if (!isValidObjectId(vehicleId)) {
      return res.status(400).json({ error: 'Invalid vehicle ID format.' });
    }

    const { planText } = req.body;

    if (!planText || typeof planText !== 'string' || !planText.trim()) {
      return res.status(400).json({ error: 'Plan description is required.' });
    }

    if (planText.trim().length > 500) {
      return res.status(400).json({ error: 'Plan description cannot exceed 500 characters.' });
    }

    const sanitizedPlan = sanitizeText(planText.trim());

    let statusDoc = await VehicleCurrentStatus.findOne({ vehicleId });
    if (!statusDoc) {
      statusDoc = await VehicleCurrentStatus.create({
        vehicleId,
        status: 'Outside',
        current_geofence: 'UNKNOWN',
        latitude: null,
        longitude: null,
        latest_gps_timestamp: null,
        gps_status: 'GPS DATA UNAVAILABLE',
        lastUpdatedAt: null,
        plans: [],
      });
    }

    // RBAC: Check plant permission if user has restricted plant assignments and vehicle is inside a plant
    if (req.user.role !== 'Admin' && req.user.accessPlants && req.user.accessPlants.length > 0) {
      if (statusDoc.currentPlantId) {
        const allowedIds = req.user.accessPlants.map((p) => (p._id ? p._id.toString() : p.toString()));
        if (!allowedIds.includes(statusDoc.currentPlantId.toString())) {
          return res.status(403).json({ error: 'Access Denied: You do not have permission for the plant where this vehicle is located.' });
        }
      }
    }

    if (!Array.isArray(statusDoc.plans)) {
      statusDoc.plans = [];
    }
    const isOutsideVehicle =
      req.body.planType === 'Next Trip Plan' ||
      req.body.plantName === 'Outside' ||
      statusDoc.status === 'Outside';

    const planType = isOutsideVehicle ? 'Next Trip Plan' : 'Add Plan';
    const createdAt = new Date();
    const expiresAt = getPlanExpiresAt(createdAt, planType);

    // Filter out already expired plans before saving new one
    const activeExistingPlans = filterActivePlans(
      statusDoc.plans,
      statusDoc.status === 'Outside' ? 'Next Trip Plan' : 'Add Plan'
    );

    const authorName = req.user.fullName || req.user.name || req.user.username || 'Sikka Team';
    const newPlanEntry = {
      planText: sanitizedPlan,
      authorName,
      authorUsername: req.user.username,
      planType,
      createdAt,
      expiresAt,
    };

    activeExistingPlans.push(newPlanEntry);
    statusDoc.plans = activeExistingPlans;
    await statusDoc.save();

    // Automatically create Plant Plan Notification for real-time alerts across all logged in users
    try {
      const vehicle = await Vehicle.findById(vehicleId);
      const vehicleNumber = vehicle?.vehicleNumber ? vehicle.vehicleNumber.toUpperCase() : 'UNKNOWN';

      let plantId = req.body.plantId || statusDoc.currentPlantId || null;
      let plantName = req.body.plantName;
      if (!plantName) {
        if (plantId) {
          const plantDoc = await Plant.findById(plantId);
          plantName = plantDoc ? plantDoc.plantName : (statusDoc.lastExitPlantName || 'Plant');
        } else if (statusDoc.lastExitPlantName) {
          plantName = statusDoc.lastExitPlantName;
        } else {
          plantName = statusDoc.status === 'Outside' ? 'Outside' : 'Plant';
        }
      }

      let location = statusDoc.readableLocation || statusDoc.location;
      if (!location && typeof statusDoc.latitude === 'number' && typeof statusDoc.longitude === 'number') {
        const { getReadableLocation } = require('../services/locationHelper');
        const activePlants = await Plant.find({ status: 'Active' });
        location = getReadableLocation(statusDoc.latitude, statusDoc.longitude, activePlants);
      }
      if (!location) {
        location = plantName || 'Outside Location';
      }

      // Prevent duplicate notification for identical note within last 30 seconds
      const duplicate = await PlanNotification.findOne({
        vehicleId: statusDoc.vehicleId,
        planNote: sanitizedPlan,
        createdAt: { $gte: new Date(Date.now() - 30 * 1000) },
      });

      if (!duplicate) {
        const userId = req.user._id || req.user.id;
        await PlanNotification.create({
          plantId,
          plantName,
          vehicleId: statusDoc.vehicleId,
          vehicleNumber,
          planType,
          planBy: authorName,
          planByUserId: userId,
          location,
          latitude: statusDoc.latitude,
          longitude: statusDoc.longitude,
          planNote: sanitizedPlan,
          createdAt: newPlanEntry.createdAt,
          expiresAt,
          readBy: [],
        });
      }
    } catch (notifErr) {
      console.error('[Plan Notification Generation Error]:', notifErr.message);
    }

    res.json({
      message: 'Plan saved successfully.',
      plan: newPlanEntry,
      plans: statusDoc.plans,
    });
  } catch (error) {
    console.error('[Add Vehicle Plan Error]:', error);
    res.status(500).json({ error: 'Failed to save vehicle plan.' });
  }
});

// DELETE /api/dashboard/vehicles/:vehicleId/plan - Delete dispatch plan with mandatory confirmation
router.delete('/vehicles/:vehicleId/plan', async (req, res) => {
  try {
    if (req.user.role === 'Driver') {
      return res.status(403).json({ error: 'Access Denied: Drivers cannot delete vehicle plans.' });
    }

    const { vehicleId } = req.params;
    if (!isValidObjectId(vehicleId)) {
      return res.status(400).json({ error: 'Invalid vehicle ID format.' });
    }

    const { confirmation, planId } = req.body || {};
    // Mandatory confirmation: user must enter exact word "Delete"
    if (!confirmation || typeof confirmation !== 'string' || confirmation.trim() !== 'Delete') {
      return res.status(400).json({
        error: 'Mandatory confirmation failed. You must enter the exact word "Delete" to confirm deletion.',
      });
    }

    const statusDoc = await VehicleCurrentStatus.findOne({ vehicleId });
    if (!statusDoc || !Array.isArray(statusDoc.plans) || statusDoc.plans.length === 0) {
      return res.status(404).json({ error: 'No active plan found for this vehicle to delete.' });
    }

    // RBAC: Check plant permission if user has restricted plant assignments and vehicle is inside a plant
    if (req.user.role !== 'Admin' && req.user.accessPlants && req.user.accessPlants.length > 0) {
      if (statusDoc.currentPlantId) {
        const allowedIds = req.user.accessPlants.map((p) => (p._id ? p._id.toString() : p.toString()));
        if (!allowedIds.includes(statusDoc.currentPlantId.toString())) {
          return res.status(403).json({
            error: 'Access Denied: You do not have permission for the plant where this vehicle is located.',
          });
        }
      }
    }

    // Find the target plan to delete: by planId if provided, or the latest active plan
    let planIndex = -1;
    if (planId) {
      planIndex = statusDoc.plans.findIndex((p) => p._id && p._id.toString() === planId.toString());
    }
    if (planIndex === -1) {
      planIndex = statusDoc.plans.length - 1;
    }

    const targetPlan = statusDoc.plans[planIndex];
    if (!targetPlan) {
      return res.status(404).json({ error: 'Target plan could not be found.' });
    }

    // Capture plan snapshot details BEFORE deletion
    const capturedPlanId = targetPlan._id ? targetPlan._id.toString() : new mongoose.Types.ObjectId().toString();
    const capturedPlanText = targetPlan.planText;
    const capturedAuthorName = targetPlan.authorName || 'Unknown';
    const capturedAuthorUsername = targetPlan.authorUsername || '';
    const capturedCreatedAt = targetPlan.createdAt || new Date();
    const capturedPlanType = targetPlan.planType || (statusDoc.status === 'Outside' ? 'Next Trip Plan' : 'Add Plan');

    // Remove the plan from statusDoc
    statusDoc.plans.splice(planIndex, 1);
    await statusDoc.save();

    // Retrieve vehicle details for audit & notification
    const vehicle = await Vehicle.findById(vehicleId);
    const vehicleNumber = vehicle?.vehicleNumber ? vehicle.vehicleNumber.toUpperCase() : (statusDoc.vehicleNumber || 'UNKNOWN');

    // Retrieve plant / location
    let plantId = statusDoc.currentPlantId || null;
    let plantName = statusDoc.lastExitPlantName;
    if (plantId) {
      const plantDoc = await Plant.findById(plantId);
      if (plantDoc) plantName = plantDoc.plantName;
    }
    if (!plantName) {
      plantName = statusDoc.status === 'Outside' ? 'Outside' : 'Plant';
    }

    let location = statusDoc.readableLocation || statusDoc.location;
    if (!location && typeof statusDoc.latitude === 'number' && typeof statusDoc.longitude === 'number') {
      const { getReadableLocation } = require('../services/locationHelper');
      const activePlants = await Plant.find({ status: 'Active' });
      location = getReadableLocation(statusDoc.latitude, statusDoc.longitude, activePlants);
    }
    if (!location) {
      location = plantName || 'Outside Location';
    }

    // Capture authenticated deleting user information
    const deletedByName = req.user.fullName || req.user.name || req.user.username || 'Authorized User';
    const deletedByUsername = req.user.username || 'user';
    const deletedByUserId = req.user._id || req.user.id;
    const deletedAt = new Date();

    // 1. Create Permanent Audit Record (Permanent Audit Trail - Requirement 6)
    try {
      await PlanAuditLog.create({
        activityType: 'PLAN_DELETED',
        planId: capturedPlanId,
        vehicleId: statusDoc.vehicleId,
        vehicleNumber,
        plantId,
        plantName,
        location,
        planType: capturedPlanType,
        planText: capturedPlanText,
        planAuthorName: capturedAuthorName,
        planAuthorUsername: capturedAuthorUsername,
        planCreatedAt: capturedCreatedAt,
        deletedByName,
        deletedByUsername,
        deletedByUserId,
        deletedAt,
        metadata: {
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        },
      });
    } catch (auditErr) {
      console.error('[Plan Deletion Audit Log Error]:', auditErr.message);
    }

    // 2. Create Notification Bar Entry (Mandatory Delete Activity Notification - Requirements 3 & 4)
    try {
      const notifDuration = capturedPlanType === 'Next Trip Plan' ? TWENTY_FOUR_HOURS_MS : TWELVE_HOURS_MS;
      const notifExpiresAt = new Date(deletedAt.getTime() + notifDuration);

      await PlanNotification.create({
        activityType: 'PLAN_DELETED',
        plantId,
        plantName,
        vehicleId: statusDoc.vehicleId,
        vehicleNumber,
        planType: capturedPlanType,
        planBy: capturedAuthorName, // Original plan creator
        planByUserId: null,
        deletedBy: deletedByName,
        deletedByUsername,
        deletedByUserId,
        deletedAt,
        location,
        latitude: statusDoc.latitude,
        longitude: statusDoc.longitude,
        planNote: capturedPlanText,
        planCreatedAt: capturedCreatedAt,
        planId: capturedPlanId,
        createdAt: deletedAt,
        expiresAt: notifExpiresAt,
        readBy: [],
      });
    } catch (notifErr) {
      console.error('[Plan Deletion Notification Error]:', notifErr.message);
    }

    res.json({
      success: true,
      message: `Plan for vehicle ${vehicleNumber} successfully deleted.`,
      vehicleNumber,
      plans: statusDoc.plans,
      deletedPlan: {
        planId: capturedPlanId,
        vehicleNumber,
        planText: capturedPlanText,
        planAuthorName: capturedAuthorName,
        planCreatedAt: capturedCreatedAt,
        deletedByName,
        deletedAt,
      },
    });
  } catch (error) {
    console.error('[Delete Vehicle Plan Error]:', error);
    res.status(500).json({ error: 'Failed to delete vehicle plan.' });
  }
});

// GET /api/dashboard/outside/vehicles - Drilldown into vehicles currently Outside
router.get('/outside/vehicles', async (req, res) => {
  try {
    if (req.user.role === 'Driver') {
      return res.status(403).json({ error: 'Access Denied: Drivers cannot view company fleet vehicles.' });
    }

    const { getReadableLocation } = require('../services/locationHelper');
    const snapshot = await getFleetGpsSnapshot({ dashboardOnly: true });
    const vehicles = snapshot.outsideVehicles.map((item) => {
      const vehicle = item.vehicle;
      const status = item.storedStatus;
      return {
        id: vehicle._id || `gps-unregistered-${vehicle.vehicleNumber}`,
        vehicleId: vehicle._id,
        vehicleNumber: vehicle.vehicleNumber,
        registrationStatus: item.isRegistered ? 'Registered' : 'Not registered',
        lastOutPlantName: null,
        outsideSince: item.statusDetectedAt,
        plantOutDateTime: item.statusDetectedAt,
        lastLocationDateTime: item.gpsTimestamp,
        outsideHours: item.outsideHours,
        status: 'Outside',
        latitude: item.latitude,
        longitude: item.longitude,
        speed: item.speed,
        ignition: item.ignition,
        movementStatus: status?.movementStatus || null,
        dataCheck: false,
        readableLocation: item.latitude !== null && item.longitude !== null
          ? getReadableLocation(item.latitude, item.longitude, snapshot.plants)
          : 'N/A',
        latest_gps_timestamp: item.gpsTimestamp,
        gps_status: item.gpsStatus,
        gpsProviderLocations: item.providerLocations || [],
        locationDiscrepancyMeters: item.locationDiscrepancyMeters,
        last_sync_source: item.lastSyncType || status?.lastSyncType || status?.last_sync_source || null,
        fleetType: vehicle.fleetType,
        ownerName: vehicle.ownerName,
        plans: filterActivePlans(status?.plans, 'Next Trip Plan'),
      };
    });

    // Attach nearest drivers within 100m based on GPS distance (Requirements 24.2 - 24.6)
    const vehiclesWithDrivers = await attachNearestDriversToVehicles(vehicles);

    res.json({
      title: 'Outside – Vehicles',
      vehicles: vehiclesWithDrivers,
    });
  } catch (error) {
    console.error('[Dashboard Outside Vehicles Error]:', error);
    res.status(500).json({ error: 'Failed to retrieve outside vehicles.' });
  }
});

// GET /api/dashboard/outside/drivers - Drilldown into drivers currently Outside
router.get('/outside/drivers', async (req, res) => {
  try {
    if (req.user.role === 'Driver') {
      return res.status(403).json({ error: 'Access Denied: Drivers cannot view company fleet drivers.' });
    }

    const activePlants = await Plant.find({ status: 'Active' });

    // 1. Get vehicles currently Outside
    const currentStatuses = await VehicleCurrentStatus.find({
      status: 'Outside',
    })
      .populate('vehicleId', 'vehicleNumber driverName mobile fleetType ownerName status')
      .sort({ lastUpdatedAt: -1 });

    const allRegisteredDrivers = await Driver.find({ status: 'Active' });
    const driversMap = new Map();

    // A) Drivers matched from vehicles currently Outside
    for (const st of currentStatuses) {
      if (!st.vehicleId || st.vehicleId.status !== 'Active') continue;
      const v = st.vehicleId;
      const dName = (v.driverName || '').trim();
      const dMobile = (v.mobile || '').trim();

      if (dName || dMobile) {
        const matchedDriver = allRegisteredDrivers.find(
          (d) =>
            (dMobile && d.mobileNumber === dMobile) ||
            (dName && d.driverName.toLowerCase() === dName.toLowerCase())
        );

        const key = dMobile || dName;
        const readableLoc = getReadableLocation(st.latitude, st.longitude, activePlants);

        driversMap.set(key, {
          id: matchedDriver ? matchedDriver._id : `veh-${v._id}`,
          driverName: matchedDriver ? matchedDriver.driverName : dName,
          mobileNumber: matchedDriver ? matchedDriver.mobileNumber : dMobile,
          dlNumber: matchedDriver ? matchedDriver.dlNumber : '—',
          photo: (matchedDriver && matchedDriver.photo) || null,
          vehicleNumber: v.vehicleNumber,
          status: 'Outside',
          plantInTime: null,
          location: readableLoc,
          readableLocation: readableLoc,
          latitude: st.latitude,
          longitude: st.longitude,
          lastLocationAt:
            (matchedDriver && matchedDriver.lastLocationUpdateAt) || st.lastUpdatedAt,
          isStale: false,
        });
      }
    }

    // B) Registered drivers currently Outside (strictly status === 'Outside')
    for (const d of allRegisteredDrivers) {
      if (d.currentStatus === 'Outside') {
        const key = d.mobileNumber || d.driverName;
        if (!driversMap.has(key)) {
          const curLat = (d.lastLocation && typeof d.lastLocation.latitude === 'number') ? d.lastLocation.latitude : d.lastLatitude;
          const curLon = (d.lastLocation && typeof d.lastLocation.longitude === 'number') ? d.lastLocation.longitude : d.lastLongitude;

          let readableLoc = 'En route / Outside Plant';
          if (typeof curLat === 'number' && typeof curLon === 'number') {
            readableLoc = getReadableLocation(curLat, curLon, activePlants);
          }

          driversMap.set(key, {
            id: d._id,
            driverName: d.driverName,
            mobileNumber: d.mobileNumber,
            dlNumber: d.dlNumber,
            photo: d.photo || null,
            vehicleNumber: 'Unassigned',
            status: 'Outside',
            plantInTime: null,
            location: readableLoc,
            readableLocation: readableLoc,
            latitude: curLat,
            longitude: curLon,
            lastLocationAt: d.lastLocationUpdateAt || d.lastLoginAt,
            isStale: d.lastLocationUpdateAt
              ? Date.now() - new Date(d.lastLocationUpdateAt).getTime() > 25 * 60 * 1000
              : false,
          });
        }
      }
    }

    const drivers = Array.from(driversMap.values());

    res.json({
      title: 'Outside – Drivers',
      drivers,
    });
  } catch (error) {
    console.error('[Dashboard Outside Drivers Error]:', error);
    res.status(500).json({ error: 'Failed to retrieve outside drivers list.' });
  }
});

// Helper to escape HTML/XML
function escapeXml(val) {
  if (val === null || val === undefined) return '';
  return String(val)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatIST(date) {
  if (!date) return '-';
  try {
    return new Date(date).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return String(date);
  }
}

// GET /api/dashboard/plants/:plantId/export - Export plant vehicles as .xls file
router.get('/plants/:plantId/export', async (req, res) => {
  try {
    if (req.user.role === 'Driver') {
      return res.status(403).send('Access Denied: Drivers cannot export fleet reports.');
    }

    const { plantId } = req.params;
    const plant = await Plant.findById(plantId);
    if (!plant) {
      return res.status(404).send('Plant not found');
    }

    const activeVehicleIds = (await Vehicle.find({ status: 'Active' }).select('_id')).map((vehicle) => vehicle._id);
    const currentStatuses = await VehicleCurrentStatus.find({
      vehicleId: { $in: activeVehicleIds },
    })
      .populate('vehicleId', 'vehicleNumber driverName mobile fleetType ownerName status')
      .sort({ lastEntryDateTime: -1 });

    const activePlants = await Plant.find({ status: 'Active' });

    const headers = [
      'Vehicle Number',
      'Entry Date & Time',
      'Sync GPS Date Time',
      'Stay Hours',
      'Location',
      'Latest Plan',
      'Plan History (Audit Trail)',
    ];

    const headerHtml = `<tr>${headers
      .map(
        (h) =>
          `<th style="background-color:#059669;color:#ffffff;font-weight:bold;padding:10px 14px;border:1px solid #d1d5db;font-family:Arial,sans-serif;font-size:12px;text-align:left;">${escapeXml(
            h
          )}</th>`
      )
      .join('')}</tr>`;

    const rowsHtml = currentStatuses
      .filter((st) => st.vehicleId && st.vehicleId.status === 'Active')
      .map((st) => {
        const v = st.vehicleId;
        const plantEval = getVehiclePlantStatus(
          {
            latitude: st.latitude,
            longitude: st.longitude,
            gpsTimestamp: st.latest_gps_timestamp,
            entryDateTime: st.lastEntryDateTime,
          },
          activePlants
        );
        if (!plantEval.isInside || plantEval.plantId?.toString() !== plantId) return null;
        const plans = filterActivePlans(st.plans, 'Add Plan');
        const latestPlan = plans.length > 0 ? plans[plans.length - 1] : null;
        const latestPlanStr = latestPlan
          ? `${latestPlan.planText} (by ${latestPlan.authorName} on ${formatIST(latestPlan.createdAt)})`
          : 'No Plan';

        const historyStr =
          plans.length > 1
            ? plans
                .slice(0, -1)
                .map(
                  (p, idx) =>
                    `[Old Plan ${idx + 1} by ${p.authorName} (${formatIST(p.createdAt)}): ${p.planText}]`
                )
                .join('<br/>')
            : 'None';

        const readableLoc = typeof st.latitude === 'number' && typeof st.longitude === 'number'
          ? getReadableLocation(st.latitude, st.longitude, activePlants)
          : 'N/A';
        const entryDate = st.lastEntryDateTime || null;
        const gpsDate = st.latest_gps_timestamp || null;
        const stayHoursStr = plantEval.stayHours === 'N/A' ? 'N/A' : `${plantEval.stayHours} Hrs`;

        const cells = [
          v.vehicleNumber,
          formatIST(entryDate),
          formatIST(gpsDate),
          stayHoursStr,
          readableLoc,
          latestPlanStr,
          historyStr,
        ];

        return `<tr>${cells
          .map(
            (c, i) =>
              `<td style="padding:8px 12px;border:1px solid #e5e7eb;font-family:Arial,sans-serif;font-size:11px;vertical-align:top;${
                i === 0 ? 'font-weight:bold;color:#0f172a;' : 'color:#334155;'
              }">${i === 6 ? c : escapeXml(c)}</td>`
          )
          .join('')}</tr>`;
      })
      .filter(Boolean)
      .join('');

    const excelHtml = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head>
  <meta http-equiv="content-type" content="application/vnd.ms-excel; charset=UTF-8"/>
  <!--[if gte mso 9]>
  <xml>
    <x:ExcelWorkbook>
      <x:ExcelWorksheets>
        <x:ExcelWorksheet>
          <x:Name>${escapeXml(plant.plantName)}</x:Name>
          <x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
        </x:ExcelWorksheet>
      </x:ExcelWorksheets>
    </x:ExcelWorkbook>
  </xml>
  <![endif]-->
</head>
<body>
  <table border="1" style="border-collapse:collapse;">
    <thead>${headerHtml}</thead>
    <tbody>${rowsHtml}</tbody>
  </table>
</body>
</html>`;

    const plantSlug = plant.plantName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `${plantSlug}_Vehicles_${dateStr}.xls`;

    res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(excelHtml);
  } catch (error) {
    console.error('[Export Plant Vehicles Error]:', error);
    res.status(500).send('Failed to export plant vehicles.');
  }
});

// GET /api/dashboard/outside/export - Export outside vehicles as .xls file
router.get('/outside/export', async (req, res) => {
  try {
    if (req.user && req.user.role === 'Driver') {
      return res.status(403).send('Access Denied: Drivers cannot export fleet reports.');
    }

    const { getReadableLocation } = require('../services/locationHelper');
    const activePlants = await Plant.find({ status: 'Active' });

    const activeVehicleIds = (await Vehicle.find({ status: 'Active' }).select('_id')).map((vehicle) => vehicle._id);
    const currentStatuses = await VehicleCurrentStatus.find({
      vehicleId: { $in: activeVehicleIds },
    })
      .populate('vehicleId', 'vehicleNumber driverName mobile fleetType ownerName status')
      .sort({ lastUpdatedAt: -1 });

    const headers = [
      'Vehicle Number',
      'Last Out Plant Name',
      'Plant Out Date Time',
      'Last Location Date Time',
      'Outside Hour',
      'Status',
      'Driver Name-Mobile',
      'Next Trip Plan',
      'Readable Location',
    ];

    const headerHtml = `<tr>${headers
      .map(
        (h) =>
          `<th style="background-color:#f59e0b;color:#ffffff;font-weight:bold;padding:10px 14px;border:1px solid #d1d5db;font-family:Arial,sans-serif;font-size:12px;text-align:left;">${escapeXml(
            h
          )}</th>`
      )
      .join('')}</tr>`;

    const now = new Date();
    const activeExportStatuses = currentStatuses.filter((st) => {
      if (!st.vehicleId || st.vehicleId.status !== 'Active') return false;
      const evaluation = getVehiclePlantStatus(
        {
          latitude: st.latitude,
          longitude: st.longitude,
          gpsTimestamp: st.latest_gps_timestamp,
        },
        activePlants,
        { now }
      );
      return !evaluation.isInside;
    });

    const rowsHtml = activeExportStatuses
      .map((st) => {
        const v = st.vehicleId;
        const lastOutPlant = st.lastExitPlantName || 'N/A';
        const plantOutTime = st.lastExitDateTime || null;
        const gpsTime = st.latest_gps_timestamp || null;
        const outsideHour = plantOutTime && gpsTime
          ? calculateStayDuration(plantOutTime, gpsTime)
          : 'N/A';
        const driverMobile = v.driverName ? `${v.driverName} - ${v.mobile ? '+91 ' + v.mobile : ''}` : 'No Driver Available';
        const readableLoc = typeof st.latitude === 'number' && typeof st.longitude === 'number'
          ? getReadableLocation(st.latitude, st.longitude, activePlants)
          : 'N/A';
        const plans        = filterActivePlans(st.plans, 'Next Trip Plan');
        const latestPlan   = plans.length > 0 ? plans[plans.length - 1] : null;
        const latestPlanStr = latestPlan
          ? `${latestPlan.planText} (by ${latestPlan.authorName} on ${formatIST(latestPlan.createdAt)})`
          : 'No Plan';

        const cells = [
          v.vehicleNumber,
          lastOutPlant,
          formatIST(plantOutTime),
          formatIST(gpsTime),
          outsideHour,
          'Outside',
          driverMobile,
          latestPlanStr,
          readableLoc,
        ];

        return `<tr>${cells
          .map(
            (c, i) =>
              `<td style="padding:8px 12px;border:1px solid #e5e7eb;font-family:Arial,sans-serif;font-size:11px;vertical-align:top;${
                i === 0 ? 'font-weight:bold;color:#0f172a;' : 'color:#334155;'
              }">${escapeXml(c)}</td>`
          )
          .join('')}</tr>`;
      })
      .join('');

    const excelHtml = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head>
  <meta http-equiv="content-type" content="application/vnd.ms-excel; charset=UTF-8"/>
  <!--[if gte mso 9]>
  <xml>
    <x:ExcelWorkbook>
      <x:ExcelWorksheets>
        <x:ExcelWorksheet>
          <x:Name>Outside Vehicles</x:Name>
          <x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
        </x:ExcelWorksheet>
      </x:ExcelWorksheets>
    </x:ExcelWorkbook>
  </xml>
  <![endif]-->
</head>
<body>
  <table border="1" style="border-collapse:collapse;">
    <thead>${headerHtml}</thead>
    <tbody>${rowsHtml}</tbody>
  </table>
</body>
</html>`;

    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `Outside_Vehicles_${dateStr}.xls`;

    res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(excelHtml);
  } catch (error) {
    console.error('[Export Outside Vehicles Error]:', error);
    res.status(500).send('Failed to export outside vehicles.');
  }
});

module.exports = router;

const express = require('express');
const Plant = require('../models/Plant');
const Vehicle = require('../models/Vehicle');
const Driver = require('../models/Driver');
const VehicleCurrentStatus = require('../models/VehicleCurrentStatus');
const PlantEntryEvent = require('../models/PlantEntryEvent');
const { verifyToken, checkPageAccess } = require('../middleware/auth');
const {
  attachNearestDriversToVehicles,
  findNearestDriversForLocation,
} = require('../services/driverMatchingService');
const { calculateHaversineDistance } = require('../services/geofenceService');
const { getReadableLocation } = require('../services/locationHelper');

const router = express.Router();

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
              radiusMeter: driverSummary.currentPlant.radiusMeters || 500,
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

    const plantQuery = { status: 'Active' };

    // RBAC: If user has restricted plant permissions, only include those plants
    if (req.user.accessPlants && req.user.accessPlants.length > 0) {
      const allowedPlantIds = req.user.accessPlants.map((p) => (p._id ? p._id : p));
      plantQuery._id = { $in: allowedPlantIds };
    }

    const activePlants = await Plant.find(plantQuery).sort({ plantName: 1 });

    // Aggregate vehicle counts by currentPlantId and status
    // Only count Active vehicles
    const activeVehicles = await Vehicle.find({ status: 'Active' }).select('_id');
    const activeVehicleIds = activeVehicles.map((v) => v._id);

    const statuses = await VehicleCurrentStatus.find({
      vehicleId: { $in: activeVehicleIds },
    }).populate('vehicleId', 'vehicleNumber driverName mobile fleetType status');

    const plantCounts = new Map();
    const plantDrivers = new Map();
    let outsideCount = 0;
    const outsideDriversSet = new Set();

    for (const st of statuses) {
      if (!st.vehicleId || st.vehicleId.status !== 'Active') continue;

      const driverKey = (st.vehicleId.driverName && st.vehicleId.driverName.trim())
        ? st.vehicleId.driverName.trim().toLowerCase()
        : (st.vehicleId.mobile || null);

      if (st.status === 'Inside' && st.currentPlantId) {
        const pid = st.currentPlantId.toString();
        plantCounts.set(pid, (plantCounts.get(pid) || 0) + 1);

        if (!plantDrivers.has(pid)) {
          plantDrivers.set(pid, new Set());
        }
        if (driverKey) {
          plantDrivers.get(pid).add(driverKey);
        }
      } else {
        outsideCount++;
        if (driverKey) {
          outsideDriversSet.add(driverKey);
        }
      }
    }

    // Also include active registered drivers from Driver collection
    const allRegisteredDrivers = await Driver.find({ status: 'Active' });
    for (const d of allRegisteredDrivers) {
      const dKey = (d.driverName || d.mobileNumber || '').trim().toLowerCase();
      if (!dKey) continue;
      if (d.currentStatus === 'Inside' && d.currentPlantId) {
        const pid = d.currentPlantId.toString();
        if (!plantDrivers.has(pid)) plantDrivers.set(pid, new Set());
        plantDrivers.get(pid).add(dKey);
      } else if (d.currentStatus === 'Outside') {
        outsideDriversSet.add(dKey);
      }
    }

    // Dynamic widgets based on active Plant records (strictly real database counts, no mock data)
    const plantWidgets = activePlants.map((plant) => {
      const pid = plant._id.toString();
      const vCount = plantCounts.get(pid) || 0;
      const dSet = plantDrivers.get(pid);
      const dCount = dSet ? dSet.size : 0;
      const radius = plant.radiusMeter || plant.radiusMeters || 500;

      return {
        id: plant._id,
        name: plant.plantName,
        location: plant.location,
        radiusMeter: radius,
        latitude: plant.latitude,
        longitude: plant.longitude,
        vehicleCount: vCount,
        driverCount: dCount,
        isOutside: false,
      };
    });

    res.json({
      plantWidgets,
      outsideWidget: {
        id: 'outside',
        name: 'Outside',
        vehicleCount: outsideCount,
        driverCount: outsideDriversSet.size,
        isOutside: true,
      },
      totalActiveVehicles: activeVehicles.length,
      lastUpdated: new Date(),
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

    const activePlants = await Plant.find({ status: 'Active' });

    // Find current statuses for this plant
    const currentStatuses = await VehicleCurrentStatus.find({
      currentPlantId: plantId,
      status: 'Inside',
    })
      .populate('vehicleId', 'vehicleNumber driverName mobile fleetType ownerName status')
      .sort({ lastEntryDateTime: -1 });

    const vehicles = currentStatuses
      .filter((item) => item.vehicleId && item.vehicleId.status === 'Active')
      .map((item) => {
        const readableLoc =
          getReadableLocation(item.latitude, item.longitude, activePlants) ||
          `At ${plant.plantName}, ${plant.location || 'Uttar Pradesh'}`;

        return {
          id: item.vehicleId._id,
          vehicleNumber: item.vehicleId.vehicleNumber,
          driverName: item.vehicleId.driverName,
          mobile: item.vehicleId.mobile,
          fleetType: item.vehicleId.fleetType,
          ownerName: item.vehicleId.ownerName,
          entryDateTime: item.lastEntryDateTime || item.lastUpdatedAt,
          lastUpdateDateTime: item.lastUpdatedAt || item.lastEntryDateTime,
          latitude: item.latitude,
          longitude: item.longitude,
          distanceMeter: item.distanceMeter,
          status: 'Inside',
          location: readableLoc,
          readableLocation: readableLoc,
          plans: Array.isArray(item.plans) ? item.plans : [],
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
        radiusMeter: plant.radiusMeter,
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

      const plantRadius = plant.radiusMeter || plant.radiusMeters || 500;
      if (isInsideThisPlant || distToPlant <= plantRadius) {
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
        radiusMeter: plant.radiusMeter,
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
    const { planText } = req.body;

    if (!planText || !planText.trim()) {
      return res.status(400).json({ error: 'Plan description is required.' });
    }

    const trimmedPlan = planText.trim();

    let statusDoc = await VehicleCurrentStatus.findOne({ vehicleId });
    if (!statusDoc) {
      statusDoc = await VehicleCurrentStatus.create({
        vehicleId,
        status: 'Outside',
        latitude: 28.6,
        longitude: 77.3,
        plans: [],
      });
    }

    if (!Array.isArray(statusDoc.plans)) {
      statusDoc.plans = [];
    }

    const newPlanEntry = {
      planText: trimmedPlan,
      authorName: req.user.fullName || req.user.username || 'User',
      authorUsername: req.user.username,
      createdAt: new Date(),
    };

    statusDoc.plans.push(newPlanEntry);
    await statusDoc.save();

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

// GET /api/dashboard/outside/vehicles - Drilldown into vehicles currently Outside
router.get('/outside/vehicles', async (req, res) => {
  try {
    if (req.user.role === 'Driver') {
      return res.status(403).json({ error: 'Access Denied: Drivers cannot view company fleet vehicles.' });
    }

    const PlantEntry = require('../models/PlantEntry');
    const { getReadableLocation } = require('../services/locationHelper');
    const activePlants = await Plant.find({ status: 'Active' });

    const currentStatuses = await VehicleCurrentStatus.find({
      status: 'Outside',
    })
      .populate('vehicleId', 'vehicleNumber driverName mobile fleetType ownerName status')
      .sort({ lastUpdatedAt: -1 });

    const vehicleIds = currentStatuses
      .filter((s) => s.vehicleId && s.vehicleId.status === 'Active')
      .map((s) => s.vehicleId._id);

    const plantEntries = await PlantEntry.find({ vehicleId: { $in: vehicleIds } }).sort({ entryDateTime: -1 });
    const lastEntryMap = new Map();
    for (const pe of plantEntries) {
      const vid = pe.vehicleId.toString();
      if (!lastEntryMap.has(vid)) {
        lastEntryMap.set(vid, pe);
      }
    }

    const vehicles = currentStatuses
      .filter((item) => item.vehicleId && item.vehicleId.status === 'Active')
      .map((item) => {
        const lastEntry = lastEntryMap.get(item.vehicleId._id.toString());
        const lastOutPlant = item.lastExitPlantName || (lastEntry ? lastEntry.plantName : (activePlants[0]?.plantName || 'Tea Plant'));
        const plantOutTime = item.lastExitDateTime || (lastEntry ? lastEntry.entryDateTime : item.lastUpdatedAt);

        return {
          id: item.vehicleId._id,
          vehicleNumber: item.vehicleId.vehicleNumber,
          lastOutPlantName: lastOutPlant,
          plantOutDateTime: plantOutTime,
          lastLocationDateTime: item.lastUpdatedAt,
          status: 'Outside',
          latitude: item.latitude,
          longitude: item.longitude,
          readableLocation: getReadableLocation(item.latitude, item.longitude, activePlants),
          fleetType: item.vehicleId.fleetType,
          ownerName: item.vehicleId.ownerName,
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

    const currentStatuses = await VehicleCurrentStatus.find({
      currentPlantId: plantId,
      status: 'Inside',
    })
      .populate('vehicleId', 'vehicleNumber driverName mobile fleetType ownerName status')
      .sort({ lastEntryDateTime: -1 });

    const activePlants = await Plant.find({ status: 'Active' });

    const headers = [
      'Vehicle Number',
      'Entry Date & Time',
      'Last Update Date & Time',
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
        const plans = Array.isArray(st.plans) ? st.plans : [];
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

        const readableLoc =
          getReadableLocation(st.latitude, st.longitude, activePlants) ||
          `At ${plant.plantName}, ${plant.location || 'Uttar Pradesh'}`;

        const entryDate = st.lastEntryDateTime || st.lastUpdatedAt;
        const diffMs = entryDate ? Math.max(0, Date.now() - new Date(entryDate).getTime()) : 0;
        const totalMins = Math.floor(diffMs / 60000);
        const stayHoursStr = `${String(Math.floor(totalMins / 60)).padStart(2, '0')}:${String(totalMins % 60).padStart(2, '0')} Hrs`;

        const cells = [
          v.vehicleNumber,
          formatIST(entryDate),
          formatIST(st.lastUpdatedAt || entryDate),
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

    const PlantEntry = require('../models/PlantEntry');
    const { getReadableLocation } = require('../services/locationHelper');
    const activePlants = await Plant.find({ status: 'Active' });

    const currentStatuses = await VehicleCurrentStatus.find({
      status: 'Outside',
    })
      .populate('vehicleId', 'vehicleNumber driverName mobile fleetType ownerName status')
      .sort({ lastUpdatedAt: -1 });

    const vehicleIds = currentStatuses
      .filter((s) => s.vehicleId && s.vehicleId.status === 'Active')
      .map((s) => s.vehicleId._id);

    const plantEntries = await PlantEntry.find({ vehicleId: { $in: vehicleIds } }).sort({ entryDateTime: -1 });
    const lastEntryMap = new Map();
    for (const pe of plantEntries) {
      const vid = pe.vehicleId.toString();
      if (!lastEntryMap.has(vid)) {
        lastEntryMap.set(vid, pe);
      }
    }

    const headers = [
      'Vehicle Number',
      'Last Out Plant Name',
      'Plant Out Date Time',
      'Last Location Date Time',
      'Status',
      'Driver Name-Mobile',
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

    const rowsHtml = currentStatuses
      .filter((st) => st.vehicleId && st.vehicleId.status === 'Active')
      .map((st) => {
        const v = st.vehicleId;
        const lastEntry = lastEntryMap.get(v._id.toString());
        const lastOutPlant = st.lastExitPlantName || (lastEntry ? lastEntry.plantName : (activePlants[0]?.plantName || 'Tea Plant'));
        const plantOutTime = st.lastExitDateTime || (lastEntry ? lastEntry.entryDateTime : st.lastUpdatedAt);
        const driverMobile = v.driverName ? `${v.driverName} - ${v.mobile ? '+91 ' + v.mobile : ''}` : 'No Driver Available';
        const readableLoc = getReadableLocation(st.latitude, st.longitude, activePlants);

        const cells = [
          v.vehicleNumber,
          lastOutPlant,
          formatIST(plantOutTime),
          formatIST(st.lastUpdatedAt),
          'Outside',
          driverMobile,
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

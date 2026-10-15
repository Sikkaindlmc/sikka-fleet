const Driver = require('../models/Driver');
const Vehicle = require('../models/Vehicle');
const VehicleCurrentStatus = require('../models/VehicleCurrentStatus');
const { calculateHaversineDistance } = require('./geofenceService');

// Default fallback radius if not specified on driver
const DEFAULT_DRIVER_RADIUS_METERS = 100;

// Maximum acceptable freshness window for GPS matching (35 minutes to cover 30-minute sync cycle + grace)
const DRIVER_GPS_FRESHNESS_MS = 35 * 60 * 1000;

/**
 * Calculates distance between two GPS coordinates in meters using the Haversine formula.
 */
function getDistance(lat1, lon1, lat2, lon2) {
  if (typeof calculateHaversineDistance === 'function') {
    return calculateHaversineDistance(lat1, lon1, lat2, lon2);
  }
  const R = 6371000;
  const toRad = (angle) => (angle * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 100) / 100;
}

/**
 * Fetches all Active drivers who have valid, recent GPS coordinates.
 * Reads the latest radiusFromVehicleMeter configured for each driver (Rule F).
 */
async function getAvailableActiveDrivers() {
  const drivers = await Driver.find({ status: 'Active' });
  const now = Date.now();

  const available = [];
  for (const d of drivers) {
    const lat = d.lastLocation?.latitude ?? d.lastLoginLocation?.latitude;
    const lng = d.lastLocation?.longitude ?? d.lastLoginLocation?.longitude;
    const capturedAt = d.lastLocationUpdateAt ?? d.lastLocation?.capturedAt ?? d.lastLoginLocation?.capturedAt;

    if (
      typeof lat === 'number' &&
      typeof lng === 'number' &&
      !isNaN(lat) &&
      !isNaN(lng) &&
      !(lat === 0 && lng === 0)
    ) {
      const isWithinWindow = capturedAt ? now - new Date(capturedAt).getTime() <= DRIVER_GPS_FRESHNESS_MS : false;
      const isDeducted = d.locationDeductionStatus === 'Location Deducted' && isWithinWindow;

      const configuredRadius =
        typeof d.radiusFromVehicleMeter === 'number' && !isNaN(d.radiusFromVehicleMeter)
          ? d.radiusFromVehicleMeter
          : DEFAULT_DRIVER_RADIUS_METERS;

      available.push({
        id: d._id.toString(),
        driverId: d._id,
        driverName: d.driverName,
        dlNumber: d.dlNumber,
        mobileNumber: d.mobileNumber,
        photo: d.photo || null,
        radiusFromVehicleMeter: configuredRadius,
        latitude: lat,
        longitude: lng,
        capturedAt: capturedAt || null,
        isFresh: isDeducted,
        locationDeductionStatus: isDeducted ? 'Location Deducted' : 'Location Not Deducted',
      });
    }
  }

  return available;
}

/**
 * Finds all active drivers within their configured radius (or a custom threshold)
 * of a given coordinate.
 */
async function findNearestDriversForLocation(targetLat, targetLng, preloadedDrivers = null, overrideRadius = null) {
  if (typeof targetLat !== 'number' || typeof targetLng !== 'number' || isNaN(targetLat) || isNaN(targetLng)) {
    return {
      nearestDrivers: [],
      nearestDriver: null,
      count: 0,
      multipleDrivers: false,
      noDriver: true,
    };
  }

  const drivers = preloadedDrivers || (await getAvailableActiveDrivers());

  const matched = [];
  for (const driver of drivers) {
    const threshold = overrideRadius !== null ? overrideRadius : driver.radiusFromVehicleMeter;
    const dist = getDistance(targetLat, targetLng, driver.latitude, driver.longitude);

    if (dist <= threshold) {
      matched.push({
        id: driver.id,
        driverId: driver.driverId,
        driverName: driver.driverName,
        dlNumber: driver.dlNumber,
        mobileNumber: driver.mobileNumber,
        photo: driver.photo,
        distanceMeters: Math.round(dist),
        radiusFromVehicleMeter: driver.radiusFromVehicleMeter,
        lastLocationAt: driver.capturedAt,
      });
    }
  }

  // Sort nearest distance first (Requirement 4 & 5)
  matched.sort((a, b) => a.distanceMeters - b.distanceMeters);

  const count = matched.length;

  return {
    nearestDrivers: matched,
    nearestDriver: count > 0 ? matched[0] : null,
    count,
    multipleDrivers: count > 1,
    noDriver: count === 0,
  };
}

/**
 * Attaches nearest driver information to a list of vehicle objects based on GPS proximity
 * and each driver's individual configured radius.
 *
 * @param {Array} vehicles - Array of vehicles containing latitude & longitude
 */
async function attachNearestDriversToVehicles(vehicles) {
  if (!Array.isArray(vehicles) || vehicles.length === 0) {
    return vehicles;
  }

  const activeDrivers = await getAvailableActiveDrivers();

  return vehicles.map((v) => {
    const lat = typeof v.latitude === 'number' ? v.latitude : null;
    const lng = typeof v.longitude === 'number' ? v.longitude : null;

    if (lat === null || lng === null) {
      return {
        ...v,
        nearestDrivers: [],
        driverName: v.driverName || null,
        mobile: v.mobile || null,
        noDriver: !v.driverName,
        multipleDrivers: false,
      };
    }

    const matched = [];
    for (const driver of activeDrivers) {
      const dist = getDistance(lat, lng, driver.latitude, driver.longitude);
      const radiusLimit = driver.radiusFromVehicleMeter || DEFAULT_DRIVER_RADIUS_METERS;

      if (dist <= radiusLimit) {
        matched.push({
          id: driver.id,
          driverId: driver.driverId,
          driverName: driver.driverName,
          dlNumber: driver.dlNumber,
          mobileNumber: driver.mobileNumber,
          photo: driver.photo,
          distanceMeters: Math.round(dist),
          radiusFromVehicleMeter: radiusLimit,
          lastLocationAt: driver.capturedAt,
        });
      }
    }

    // Sort by nearest distance first
    matched.sort((a, b) => a.distanceMeters - b.distanceMeters);

    const count = matched.length;

    // Case 1: Exactly 1 Driver within configured radius -> display driver name + phone + distance
    if (count === 1) {
      return {
        ...v,
        nearestDrivers: matched,
        driverName: matched[0].driverName,
        mobile: matched[0].mobileNumber,
        driverDistance: matched[0].distanceMeters,
        multipleDrivers: false,
        noDriver: false,
      };
    }

    // Case 2: Multiple Drivers within radius -> display count + View Drivers
    if (count > 1) {
      return {
        ...v,
        nearestDrivers: matched,
        driverName: `${count} Drivers Available`,
        mobile: null,
        driverDistance: matched[0].distanceMeters,
        multipleDrivers: true,
        noDriver: false,
      };
    }

    // Case 3: No Driver within configured radius -> maintain assigned driver if already present
    return {
      ...v,
      nearestDrivers: [],
      driverName: v.driverName || null,
      mobile: v.mobile || null,
      driverDistance: null,
      multipleDrivers: false,
      noDriver: !v.driverName,
    };
  });
}

/**
 * Executes automated GPS-based driver-to-vehicle assignment (Feature 2, 3, 5).
 * Called automatically during every 30-minute background sync cycle.
 *
 * Rules:
 * Rule A: Exactly one matching driver -> automatically assign driver to vehicle if business rules permit.
 * Rule B: Multiple matching drivers -> do NOT arbitrarily assign or overwrite. Store candidate list.
 * Rule C: Existing assignments -> Check whether vehicle or driver is already assigned elsewhere.
 * Rule D: No matching driver -> do not create new assignment. Keep existing assignments intact.
 * Rule E: Missing or outdated GPS coordinates -> skip comparison and record reasons.
 * Rule F: Driver radius changes -> uses the latest saved radius per driver.
 */
async function executeAutomatedDriverAssignment() {
  const startedAt = new Date();
  console.log(`[Driver Assignment] Starting 30-minute automated assignment cycle at ${startedAt.toISOString()}...`);

  const summary = {
    startedAt,
    completedAt: null,
    driversChecked: 0,
    vehiclesChecked: 0,
    eligibleMatches: 0,
    autoAssignmentsCompleted: 0,
    vehiclesWithMultipleDrivers: 0,
    comparisonsSkipped: 0,
    skippedReasons: [],
    assignmentConflicts: [],
    assignmentDetails: [],
  };

  try {
    // 1. Retrieve all active vehicles and drivers
    const activeVehicles = await Vehicle.find({ status: 'Active' });
    const allActiveDrivers = await Driver.find({ status: 'Active' });

    summary.vehiclesChecked = activeVehicles.length;
    summary.driversChecked = allActiveDrivers.length;

    const now = Date.now();

    // 2. Filter eligible drivers with valid, non-stale GPS coordinates (Rule E)
    const eligibleDrivers = [];
    for (const d of allActiveDrivers) {
      const lat = d.lastLocation?.latitude ?? d.lastLoginLocation?.latitude;
      const lng = d.lastLocation?.longitude ?? d.lastLoginLocation?.longitude;
      const capturedAt = d.lastLocationUpdateAt ?? d.lastLocation?.capturedAt ?? d.lastLoginLocation?.capturedAt;

      if (
        typeof lat !== 'number' ||
        typeof lng !== 'number' ||
        isNaN(lat) ||
        isNaN(lng) ||
        (lat === 0 && lng === 0)
      ) {
        summary.comparisonsSkipped++;
        summary.skippedReasons.push(`Driver '${d.driverName}' (${d.dlNumber}): Missing GPS coordinates`);
        continue;
      }

      const ageMs = capturedAt ? now - new Date(capturedAt).getTime() : Infinity;
      if (ageMs > DRIVER_GPS_FRESHNESS_MS) {
        summary.comparisonsSkipped++;
        summary.skippedReasons.push(
          `Driver '${d.driverName}' (${d.dlNumber}): Outdated GPS coordinates (${Math.round(ageMs / 60000)}m old)`
        );
        continue;
      }

      const configuredRadius =
        typeof d.radiusFromVehicleMeter === 'number' && !isNaN(d.radiusFromVehicleMeter)
          ? d.radiusFromVehicleMeter
          : DEFAULT_DRIVER_RADIUS_METERS;

      eligibleDrivers.push({
        id: d._id.toString(),
        driverId: d._id,
        driverName: d.driverName,
        dlNumber: d.dlNumber,
        mobileNumber: d.mobileNumber,
        photo: d.photo || null,
        radiusFromVehicleMeter: configuredRadius,
        latitude: lat,
        longitude: lng,
        capturedAt: capturedAt || null,
      });
    }

    // 3. Load latest vehicle locations from VehicleCurrentStatus
    const vehicleStatusDocs = await VehicleCurrentStatus.find({
      vehicleId: { $in: activeVehicles.map((v) => v._id) },
    });
    const statusMap = new Map();
    for (const st of vehicleStatusDocs) {
      statusMap.set(st.vehicleId.toString(), st);
    }

    // Set of drivers who are currently assigned to an active vehicle (Rule C)
    const assignedDriverIds = new Set();
    const assignedDriverMobiles = new Set();

    for (const v of activeVehicles) {
      if (v.assignedDriverId) {
        assignedDriverIds.add(v.assignedDriverId.toString());
      }
      if (v.mobile) {
        assignedDriverMobiles.add(v.mobile);
      }
    }

    // 4. Process each vehicle
    for (const vehicle of activeVehicles) {
      const vStatus = statusMap.get(vehicle._id.toString());
      const vLat = vStatus?.latitude ?? null;
      const vLng = vStatus?.longitude ?? null;

      if (
        typeof vLat !== 'number' ||
        typeof vLng !== 'number' ||
        isNaN(vLat) ||
        isNaN(vLng) ||
        (vLat === 0 && vLng === 0)
      ) {
        summary.comparisonsSkipped++;
        summary.skippedReasons.push(`Vehicle '${vehicle.vehicleNumber}': GPS coordinates missing or invalid`);
        continue;
      }

      // Check vehicle GPS freshness
      if (vStatus && (vStatus.gps_status === 'GPS STALE' || vStatus.gps_status === 'GPS DATA UNAVAILABLE')) {
        summary.comparisonsSkipped++;
        summary.skippedReasons.push(
          `Vehicle '${vehicle.vehicleNumber}': Telematics status is '${vStatus.gps_status}'`
        );
        continue;
      }

      // Find all eligible drivers within their respective radius for this vehicle
      const matchingDrivers = [];
      for (const driver of eligibleDrivers) {
        const dist = getDistance(vLat, vLng, driver.latitude, driver.longitude);
        if (dist <= driver.radiusFromVehicleMeter) {
          matchingDrivers.push({
            id: driver.id,
            driverId: driver.driverId,
            driverName: driver.driverName,
            dlNumber: driver.dlNumber,
            mobileNumber: driver.mobileNumber,
            photo: driver.photo,
            distanceMeters: Math.round(dist),
            radiusFromVehicleMeter: driver.radiusFromVehicleMeter,
            lastLocationAt: driver.capturedAt,
          });
        }
      }

      // Sort nearest first (Section 4 requirement)
      matchingDrivers.sort((a, b) => a.distanceMeters - b.distanceMeters);

      const matchCount = matchingDrivers.length;

      if (matchCount > 0) {
        summary.eligibleMatches += matchCount;
      }

      // =======================================================================
      // CASE 1: EXACTLY ONE MATCHING DRIVER (Rule A)
      // =======================================================================
      if (matchCount === 1) {
        const candidate = matchingDrivers[0];
        const candidateId = candidate.id;
        const candidateMobile = candidate.mobileNumber;

        // Check if vehicle already has this exact driver assigned
        const isAlreadyAssignedToThis =
          (vehicle.assignedDriverId && vehicle.assignedDriverId.toString() === candidateId) ||
          (vehicle.driverName &&
            vehicle.driverName.toLowerCase() === candidate.driverName.toLowerCase() &&
            vehicle.mobile === candidateMobile);

        if (isAlreadyAssignedToThis) {
          // Maintain assignment and update distance in VehicleCurrentStatus
          if (vStatus) {
            vStatus.driverDistance = candidate.distanceMeters;
            vStatus.matchingDrivers = matchingDrivers;
            vStatus.matchingDriversCount = 1;
            await vStatus.save();
          }
          vehicle.matchingDrivers = matchingDrivers;
          await vehicle.save();
          continue;
        }

        // Rule C: Check if driver is already assigned to a DIFFERENT active vehicle
        const isDriverAssignedElsewhere =
          (assignedDriverIds.has(candidateId) || assignedDriverMobiles.has(candidateMobile)) &&
          !isAlreadyAssignedToThis;

        if (isDriverAssignedElsewhere) {
          const conflictMsg = `Driver '${candidate.driverName}' is within ${candidate.distanceMeters}m of vehicle '${vehicle.vehicleNumber}', but is already assigned to another vehicle.`;
          summary.assignmentConflicts.push(conflictMsg);
          console.warn(`[Driver Assignment Conflict]: ${conflictMsg}`);

          // Record candidate drivers for UI awareness without overwriting
          vehicle.matchingDrivers = matchingDrivers;
          await vehicle.save();

          if (vStatus) {
            vStatus.matchingDrivers = matchingDrivers;
            vStatus.matchingDriversCount = 1;
            vStatus.driverDistance = candidate.distanceMeters;
            await vStatus.save();
          }
          continue;
        }

        // Rule C: If vehicle was MANUALLY assigned to another driver with an active assignment, do not auto-overwrite
        if (vehicle.assignmentType === 'MANUAL' && vehicle.driverName && vehicle.assignedDriverId) {
          const conflictMsg = `Vehicle '${vehicle.vehicleNumber}' already has manual assignment to '${vehicle.driverName}'. Skipping auto-overwrite by '${candidate.driverName}'.`;
          summary.assignmentConflicts.push(conflictMsg);
          console.log(`[Driver Assignment Skip]: ${conflictMsg}`);

          vehicle.matchingDrivers = matchingDrivers;
          await vehicle.save();

          if (vStatus) {
            vStatus.matchingDrivers = matchingDrivers;
            vStatus.matchingDriversCount = 1;
            vStatus.driverDistance = candidate.distanceMeters;
            await vStatus.save();
          }
          continue;
        }

        // Execute automatic assignment!
        const previousDriverName = vehicle.driverName;
        vehicle.assignedDriverId = candidate.driverId;
        vehicle.driverName = candidate.driverName;
        vehicle.mobile = candidateMobile;
        vehicle.assignmentType = 'AUTO_GPS';
        vehicle.assignedAt = new Date();
        vehicle.matchingDrivers = matchingDrivers;
        await vehicle.save();

        if (vStatus) {
          vStatus.driverDistance = candidate.distanceMeters;
          vStatus.matchingDrivers = matchingDrivers;
          vStatus.matchingDriversCount = 1;
          vStatus.assignmentType = 'AUTO_GPS';
          await vStatus.save();
        }

        assignedDriverIds.add(candidateId);
        assignedDriverMobiles.add(candidateMobile);

        summary.autoAssignmentsCompleted++;
        summary.assignmentDetails.push({
          vehicleNumber: vehicle.vehicleNumber,
          driverName: candidate.driverName,
          distanceMeters: candidate.distanceMeters,
          configuredRadius: candidate.radiusFromVehicleMeter,
          previousDriver: previousDriverName || 'None',
        });

        console.log(
          `[Driver Assignment AUTO] Assigned Driver '${candidate.driverName}' (+91 ${candidateMobile}) to Vehicle '${vehicle.vehicleNumber}' (Distance: ${candidate.distanceMeters}m / Radius: ${candidate.radiusFromVehicleMeter}m)`
        );
      }

      // =======================================================================
      // CASE 2: MULTIPLE MATCHING DRIVERS (Rule B)
      // =======================================================================
      else if (matchCount > 1) {
        summary.vehiclesWithMultipleDrivers++;

        // Store candidate matching drivers so "View Drivers" modal can show all of them
        vehicle.matchingDrivers = matchingDrivers;
        await vehicle.save();

        if (vStatus) {
          vStatus.matchingDrivers = matchingDrivers;
          vStatus.matchingDriversCount = matchCount;
          vStatus.driverDistance = matchingDrivers[0].distanceMeters;
          await vStatus.save();
        }

        console.log(
          `[Driver Assignment MULTIPLE] Vehicle '${vehicle.vehicleNumber}' has ${matchCount} eligible drivers within radius. Kept pending for manual selection.`
        );
      }

      // =======================================================================
      // CASE 3: NO MATCHING DRIVER (Rule D)
      // =======================================================================
      else {
        // Clear candidates list but DO NOT remove existing assignment (Rule D)
        vehicle.matchingDrivers = [];
        await vehicle.save();

        if (vStatus) {
          vStatus.matchingDrivers = [];
          vStatus.matchingDriversCount = 0;
          vStatus.driverDistance = null;
          await vStatus.save();
        }
      }
    }

    summary.completedAt = new Date();
    const durationMs = summary.completedAt.getTime() - startedAt.getTime();

    console.log(
      `[Driver Assignment COMPLETE] Processed: ${summary.vehiclesChecked} vehicles, ${summary.driversChecked} drivers. Auto-assigned: ${summary.autoAssignmentsCompleted}, Multiple matches: ${summary.vehiclesWithMultipleDrivers}, Duration: ${durationMs}ms.`
    );

    return summary;
  } catch (error) {
    summary.completedAt = new Date();
    console.error(`[Driver Assignment ERROR]: ${error.message}`, error);
    throw error;
  }
}

/**
 * Manually assigns an eligible driver to a vehicle (e.g. from the "View Drivers" popup).
 */
async function assignDriverManually({ vehicleId, driverId, assignedByName = 'Authorized User' }) {
  const vehicle = await Vehicle.findById(vehicleId);
  if (!vehicle) {
    throw new Error('Vehicle not found.');
  }

  const driver = await Driver.findById(driverId);
  if (!driver) {
    throw new Error('Driver not found.');
  }

  if (driver.status !== 'Active') {
    throw new Error(`Driver '${driver.driverName}' is inactive and cannot be assigned.`);
  }

  // Check if driver is already assigned to another vehicle
  const otherVehicle = await Vehicle.findOne({
    _id: { $ne: vehicle._id },
    $or: [{ assignedDriverId: driver._id }, { mobile: driver.mobileNumber }],
    status: 'Active',
  });

  if (otherVehicle) {
    // Unassign driver from previous vehicle to prevent duplicate assignment conflict (Rule C)
    otherVehicle.assignedDriverId = null;
    otherVehicle.driverName = '';
    otherVehicle.mobile = '';
    otherVehicle.assignmentType = 'NONE';
    await otherVehicle.save();

    await VehicleCurrentStatus.updateOne(
      { vehicleId: otherVehicle._id },
      { $set: { assignmentType: 'NONE' } }
    );
  }

  vehicle.assignedDriverId = driver._id;
  vehicle.driverName = driver.driverName;
  vehicle.mobile = driver.mobileNumber;
  vehicle.assignmentType = 'MANUAL';
  vehicle.assignedAt = new Date();
  vehicle.matchingDrivers = [];
  await vehicle.save();

  await VehicleCurrentStatus.updateOne(
    { vehicleId: vehicle._id },
    {
      $set: {
        matchingDrivers: [],
        matchingDriversCount: 0,
        assignmentType: 'MANUAL',
      },
    }
  );

  console.log(
    `[Driver Assignment MANUAL] User '${assignedByName}' manually assigned Driver '${driver.driverName}' to Vehicle '${vehicle.vehicleNumber}'`
  );

  return vehicle;
}

/**
 * Unassigns a driver from a vehicle.
 */
async function unassignDriverFromVehicle({ vehicleId }) {
  const vehicle = await Vehicle.findById(vehicleId);
  if (!vehicle) {
    throw new Error('Vehicle not found.');
  }

  vehicle.assignedDriverId = null;
  vehicle.driverName = '';
  vehicle.mobile = '';
  vehicle.assignmentType = 'NONE';
  vehicle.matchingDrivers = [];
  await vehicle.save();

  await VehicleCurrentStatus.updateOne(
    { vehicleId: vehicle._id },
    {
      $set: {
        matchingDrivers: [],
        matchingDriversCount: 0,
        driverDistance: null,
        assignmentType: 'NONE',
      },
    }
  );

  return vehicle;
}

module.exports = {
  DEFAULT_DRIVER_RADIUS_METERS,
  MAX_DRIVER_MATCH_RADIUS_METERS: DEFAULT_DRIVER_RADIUS_METERS,
  DRIVER_GPS_FRESHNESS_MS,
  getDistance,
  getAvailableActiveDrivers,
  findNearestDriversForLocation,
  attachNearestDriversToVehicles,
  executeAutomatedDriverAssignment,
  assignDriverManually,
  unassignDriverFromVehicle,
};

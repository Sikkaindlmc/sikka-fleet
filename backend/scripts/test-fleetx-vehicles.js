const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const axios = require('axios');
const FormData = require('form-data');
require('../models/Vehicle');
const { isVehicleAssignedToProvider } = require('../utils/gpsProvider');

const BASE_URL = (
  process.env.FLEETX_API_BASE_URL ||
  process.env.FLEETX_BASE_URL ||
  'https://api.fleetx.io'
).trim().replace(/\/$/, '');

function normalizeRegisteredNumber(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normalizeFleetxCandidate(value) {
  return String(value || '')
    .toUpperCase()
    .trim()
    .replace(/\s*[_-]\s*CAM(?:ERA)?$/i, '')
    .replace(/[^A-Z0-9]/g, '');
}

function collectLeaves(value, parentPath = '', output = []) {
  if (!value || typeof value !== 'object') {
    if (parentPath) output.push({ path: parentPath, value });
    return output;
  }
  if (Array.isArray(value)) return output;

  for (const [key, nestedValue] of Object.entries(value)) {
    const childPath = parentPath ? `${parentPath}.${key}` : key;
    if (nestedValue && typeof nestedValue === 'object' && !Array.isArray(nestedValue)) {
      collectLeaves(nestedValue, childPath, output);
    } else if (!Array.isArray(nestedValue)) {
      output.push({ path: childPath, value: nestedValue });
    }
  }
  return output;
}

function isVehicleNameOrNumberField(fieldPath) {
  const compact = fieldPath.toLowerCase().replace(/[^a-z]/g, '');
  const leaf = compact.split('.').pop();
  return (
    /vehicle(number|no|name|registration|reg|plate)/i.test(compact) ||
    /(registration(number|no)?|reg(number|no)|license(number|plate)|licence(number|plate)|plate)/i.test(compact) ||
    leaf === 'name' ||
    (/(^|\.)(vehicle|vehicleinfo|vehicledetails)\./i.test(fieldPath) && /^(number|no|name|registration)$/i.test(leaf))
  );
}

function getIdentifierFields(vehicle) {
  return collectLeaves(vehicle).filter((field) =>
    field.value !== null &&
    field.value !== undefined &&
    String(field.value).trim() !== '' &&
    isVehicleNameOrNumberField(field.path)
  );
}

function getVehicleId(vehicle) {
  const fields = collectLeaves(vehicle);
  const id = fields.find(({ path: fieldPath }) => /(^|\.)(vehicleId|vehicle_id|id)$/i.test(fieldPath));
  return id ? id.value : null;
}

function getTelemetryFields(vehicle) {
  const fields = collectLeaves(vehicle);
  const find = (pattern) => {
    const field = fields.find(({ path: fieldPath }) => pattern.test(fieldPath));
    return field ? field.value : 'not returned';
  };
  const latitude = find(/(^|\.)(latitude|lat)$/i);
  const longitude = find(/(^|\.)(longitude|lon|lng)$/i);
  const speed = find(/(^|\.)speed$/i);
  const ignition = find(/(^|\.)(ignition|ignitionStatus)$/i);
  const lastUpdate = find(/(^|\.)(lastUpdatedAt|lastStatusTime|gpsTimestamp|lastUpdate|gpsTime|updatedAt|serverTime|timestamp)$/i);
  let formattedLastUpdate = lastUpdate;
  const numericTimestamp = Number(lastUpdate);
  if (Number.isFinite(numericTimestamp) && numericTimestamp > 0) {
    const date = new Date(numericTimestamp > 1e11 ? numericTimestamp : numericTimestamp * 1000);
    if (!Number.isNaN(date.getTime())) {
      formattedLastUpdate = `${date.toISOString()} (${date.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST)`;
    }
  }
  return { latitude, longitude, speed, ignition, lastUpdate: formattedLastUpdate };
}

function extractVehicles(payload) {
  const candidates = [
    payload?.vehicles,
    payload?.data?.vehicles,
    payload?.data,
    payload?.list,
    payload?.items,
    payload?.records,
    payload?.results,
    payload?.content,
    payload,
  ];
  return candidates.find(Array.isArray) || [];
}

function getPaginationMetadata(payload) {
  const paginationKeys = /^(page|pageNumber|pageIndex|totalPages|pages|hasNext|hasMore|nextPage|nextCursor|cursor|totalElements|totalRecords|pageSize|limit|offset)$/i;
  const totalKeys = /^(totalVehicles|totalElements|totalRecords|vehicleCount)$/i;
  const metadata = collectLeaves(payload).filter(({ path: fieldPath }) => {
    const key = fieldPath.split('.').pop();
    return paginationKeys.test(key) || totalKeys.test(key);
  });
  const indicatesPaging = metadata.some(({ path: fieldPath, value }) => {
    const key = fieldPath.split('.').pop();
    return (
      /^(totalPages|pages)$/i.test(key) && Number(value) > 1 ||
      /^(hasNext|hasMore|nextPage|nextCursor)$/i.test(key) && Boolean(value)
    );
  });
  return { metadata, indicatesPaging };
}

function editDistance(left, right) {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= right.length; j++) {
      const current = row[j];
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        previous + (left[i - 1] === right[j - 1] ? 0 : 1)
      );
      previous = current;
    }
  }
  return row[right.length];
}

async function getFleetxVehicles() {
  const form = new FormData();
  form.append('username', process.env.FLEETX_USERNAME || '');
  form.append('password', process.env.FLEETX_PASSWORD || '');
  form.append('grant_type', 'password');

  const login = await axios.post(`${BASE_URL}/api/v1/login`, form, {
    headers: {
      Authorization: (process.env.FLEETX_BASIC_AUTH || '').startsWith('Basic ')
        ? process.env.FLEETX_BASIC_AUTH
        : `Basic ${process.env.FLEETX_BASIC_AUTH || ''}`,
      ...form.getHeaders(),
    },
    timeout: 15000,
  });
  const token = login.data?.access_token || login.data?.accessToken || login.data?.token;
  if (!token) throw new Error('FleetX login returned no access token.');

  const response = await axios.get(`${BASE_URL}/api/v1/analytics/live`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    timeout: 15000,
  });
  return { payload: response.data, status: response.status };
}

function printClosest(registeredNumber, fleetxVehicles) {
  const target = normalizeRegisteredNumber(registeredNumber);
  let closest = null;
  for (const fleetxVehicle of fleetxVehicles) {
    for (const field of getIdentifierFields(fleetxVehicle)) {
      const normalized = normalizeRegisteredNumber(field.value);
      if (!normalized) continue;
      const distance = editDistance(target, normalized);
      if (!closest || distance < closest.distance) {
        closest = { value: field.value, path: field.path, distance };
      }
    }
  }
  return closest;
}

async function main() {
  const requiredFleetxEnv = ['FLEETX_USERNAME', 'FLEETX_PASSWORD', 'FLEETX_BASIC_AUTH'];
  const missingFleetxEnv = requiredFleetxEnv.filter((key) => !String(process.env[key] || '').trim());
  if (missingFleetxEnv.length) {
    throw new Error(`FleetX credentials are empty: ${missingFleetxEnv.join(', ')}`);
  }

  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.MONGODB_DIRECT_URI;
  if (!uri) {
    throw new Error('MongoDB URI is not configured (MONGODB_URI, MONGO_URI, or MONGODB_DIRECT_URI).');
  }

  let fleetxVehicles;
  try {
    const result = await getFleetxVehicles();
    fleetxVehicles = extractVehicles(result.payload);
    const pagination = getPaginationMetadata(result.payload);
    const declaredTotal = collectLeaves(result.payload).find(({ path: fieldPath }) =>
      /(^|\.)(totalVehicles|totalElements|totalRecords|vehicleCount)$/i.test(fieldPath)
    )?.value;

    console.log(`FleetX live API HTTP status: ${result.status}`);
    console.log(`Vehicles in response: ${fleetxVehicles.length}`);
    console.log(`API-declared total: ${declaredTotal ?? 'not provided'}`);
    console.log(`Pagination: ${pagination.indicatesPaging ? 'indicated by response metadata' : 'no additional pages indicated by response metadata'}`);
    console.log(`Pagination metadata: ${pagination.metadata.length
      ? pagination.metadata.map(({ path: fieldPath, value }) => `${fieldPath}=${String(value)}`).join(', ')
      : 'none'}`);
    console.log('\nFleetX vehicles:');
    fleetxVehicles.forEach((fleetxVehicle, index) => {
      const identifierFields = getIdentifierFields(fleetxVehicle);
      const telemetry = getTelemetryFields(fleetxVehicle);
      console.log(`  ${index + 1}.`);
      console.log(`     Number/name fields: ${identifierFields.length
        ? identifierFields.map(({ path: fieldPath, value }) => `${fieldPath}=${String(value)}`).join(' | ')
        : 'none found'}`);
      console.log(`     vehicleId: ${getVehicleId(fleetxVehicle) ?? 'not returned'}`);
      console.log(`     latitude: ${telemetry.latitude}; longitude: ${telemetry.longitude}; speed: ${telemetry.speed}; ignition: ${telemetry.ignition}; last update: ${telemetry.lastUpdate}`);
    });
  } catch (error) {
    const status = error.response?.status;
    const code = error.code || 'REQUEST_FAILED';
    throw new Error(`FleetX request failed${status ? ` with HTTP ${status}` : ` (${code})`}.`);
  }

  try {
    await mongoose.connect(uri, {
      dbName: process.env.MONGODB_DB_NAME || 'sikka_fleet',
      serverSelectionTimeoutMS: 10000,
    });
    const Vehicle = mongoose.model('Vehicle');
    const vehicles = (await Vehicle.find({})
      .select('vehicleNumber fleetxVehicleId gps_provider gpsProvider gpsProviders')
      .lean())
      .filter((vehicle) => isVehicleAssignedToProvider(vehicle, 'FLEETX'));

    console.log(`\nRegistered FleetX vehicles in MongoDB: ${vehicles.length}`);
    for (const vehicle of vehicles) {
      const currentMatch = fleetxVehicles.find((fleetxVehicle) => {
        const fields = getIdentifierFields(fleetxVehicle);
        const currentMatcherFields = fields.filter(({ path: fieldPath }) =>
          /(^|\.)(vehicleNumber|vehicleRegistrationNumber|vehicleName|name)$/i.test(fieldPath)
        );
        return currentMatcherFields.some(({ value }) =>
          normalizeRegisteredNumber(normalizeFleetxCandidate(value)) === normalizeRegisteredNumber(vehicle.vehicleNumber)
        );
      });
      const storedIdMatch = vehicle.fleetxVehicleId
        ? fleetxVehicles.find((fleetxVehicle) => String(getVehicleId(fleetxVehicle)) === String(vehicle.fleetxVehicleId))
        : null;

      console.log(`  ${vehicle.vehicleNumber} (stored FleetX vehicleId: ${vehicle.fleetxVehicleId || 'none'})`);
      if (currentMatch) {
        console.log('    MATCHED by current number/name matching');
      } else {
        console.log('    NOT FOUND by current number/name matching');
        if (storedIdMatch) console.log('    Stored vehicleId matches a FleetX record; current sync does not match by ID');
        const closest = printClosest(vehicle.vehicleNumber, fleetxVehicles);
        console.log(`    Closest FleetX value: ${closest
          ? `${closest.value} (${closest.path}; edit distance ${closest.distance})`
          : 'none (FleetX returned no number/name fields)'}`);
      }
    }
  } catch (error) {
    if (error.message.startsWith('MongoDB URI')) throw error;
    throw new Error(`MongoDB lookup failed (${error.code || 'DATABASE_ERROR'}).`);
  } finally {
    if (mongoose.connection.readyState) await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

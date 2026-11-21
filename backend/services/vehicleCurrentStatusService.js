const mongoose = require('mongoose');
const VehicleCurrentStatus = require('../models/VehicleCurrentStatus');

async function updateVehicleCurrentStatus(vehicleId, fields, insertFields = {}) {
  const objectId = vehicleId instanceof mongoose.Types.ObjectId
    ? vehicleId
    : new mongoose.Types.ObjectId(String(vehicleId));
  const filter = { vehicleId: objectId };
  const update = { $set: fields };
  if (Object.keys(insertFields).length > 0) update.$setOnInsert = insertFields;

  try {
    return await VehicleCurrentStatus.updateOne(filter, update, {
      upsert: true,
      setDefaultsOnInsert: true,
    });
  } catch (error) {
    if (error.code !== 11000) throw error;

    console.warn(`[GPS Status Upsert] Duplicate-key race for vehicle ${objectId}; retrying update.`);
    try {
      return await VehicleCurrentStatus.updateOne(filter, update, {
        upsert: true,
        setDefaultsOnInsert: true,
      });
    } catch (retryError) {
      if (retryError.code !== 11000) throw retryError;
      const result = await VehicleCurrentStatus.updateOne(filter, update, { upsert: false });
      if (!result.matchedCount) throw retryError;
      return result;
    }
  }
}

module.exports = { updateVehicleCurrentStatus };

// Centralized Mongoose Model Registry
// Ensures all models and their schema references (populate) are registered unconditionally

const User = require('./User');
const Plant = require('./Plant');
const Driver = require('./Driver');
const Vehicle = require('./Vehicle');
const VehicleCurrentStatus = require('./VehicleCurrentStatus');
const VehicleLocation = require('./VehicleLocation');
const PlanNotification = require('./PlanNotification');
const PlantEntry = require('./PlantEntry');
const PlantEntryEvent = require('./PlantEntryEvent');
const GpsConfig = require('./GpsConfig');
const GpsSetting = require('./GpsSetting');
const GpsSyncLock = require('./GpsSyncLock');
const GpsSyncLog = require('./GpsSyncLog');
const CronExecutionLog = require('./CronExecutionLog');
const DriverLocation = require('./DriverLocation');
const DriverPlantRecord = require('./DriverPlantRecord');
const Page = require('./Page');
const PlanAuditLog = require('./PlanAuditLog');

module.exports = {
  User,
  Plant,
  Driver,
  Vehicle,
  VehicleCurrentStatus,
  VehicleLocation,
  PlanNotification,
  PlanAuditLog,
  PlantEntry,
  PlantEntryEvent,
  GpsConfig,
  GpsSetting,
  GpsSyncLock,
  GpsSyncLog,
  CronExecutionLog,
  DriverLocation,
  DriverPlantRecord,
  Page,
};

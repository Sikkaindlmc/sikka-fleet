// Centralized Mongoose Model Registry
// Ensures all models and their schema references (populate) are registered unconditionally

const User = require('./User');
const Plant = require('./Plant');
const Driver = require('./Driver');
const AuthSession = require('./AuthSession');
const Vehicle = require('./Vehicle');
const VehicleCurrentStatus = require('./VehicleCurrentStatus');
const VehicleLocation = require('./VehicleLocation');
const PlanNotification = require('./PlanNotification');
const PlantEntry = require('./PlantEntry');
const PlantEntryEvent = require('./PlantEntryEvent');
const GpsSetting = require('./GpsSetting');
const GpsSyncLock = require('./GpsSyncLock');
const GpsSyncLog = require('./GpsSyncLog');
const CronExecutionLog = require('./CronExecutionLog');
const DriverLocation = require('./DriverLocation');
const DriverPlantRecord = require('./DriverPlantRecord');
const Page = require('./Page');
const PlanAuditLog = require('./PlanAuditLog');
const GpsHistory = require('./GpsHistory');
const PlantStay = require('./PlantStay');
const ZoneSession = require('./ZoneSession');
const DailyGpsReport = require('./DailyGpsReport');
const GpsCredentialAuditLog = require('./GpsCredentialAuditLog');
const SikkaAiAuditLog = require('./SikkaAiAuditLog');
const SikkaAiSyncCooldown = require('./SikkaAiSyncCooldown');

module.exports = {
  User,
  Plant,
  Driver,
  AuthSession,
  Vehicle,
  VehicleCurrentStatus,
  VehicleLocation,
  PlanNotification,
  PlanAuditLog,
  GpsHistory,
  PlantStay,
  ZoneSession,
  DailyGpsReport,
  GpsCredentialAuditLog,
  SikkaAiAuditLog,
  SikkaAiSyncCooldown,
  PlantEntry,
  PlantEntryEvent,
  GpsSetting,
  GpsSyncLock,
  GpsSyncLog,
  CronExecutionLog,
  DriverLocation,
  DriverPlantRecord,
  Page,
};

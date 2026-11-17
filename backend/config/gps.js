const configuredStaleMinutes = Number(process.env.GPS_STALE_THRESHOLD_MINUTES);
const staleMinutes = Number.isFinite(configuredStaleMinutes) && configuredStaleMinutes > 0
  ? configuredStaleMinutes
  : 30;

module.exports = {
  GPS_STALE_THRESHOLD_MS: staleMinutes * 60 * 1000,
};

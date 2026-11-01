const { generateFleetReport } = require('../../backend/services/reportCalculationService');
(async () => {
  try {
    const report = await generateFleetReport({ fromDate: '2026-11-01', toDate: '2026-11-01', vehicleNumber: 'ALL' });
    console.log(JSON.stringify(report, null, 2));
  } catch (e) {
    console.error('Error:', e);
  }
})();

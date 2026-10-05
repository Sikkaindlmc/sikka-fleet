const express = require('express');
const XLSX = require('xlsx');
const Vehicle = require('../models/Vehicle');
const Driver = require('../models/Driver');
const { verifyToken, checkPageAccess } = require('../middleware/auth');
const {
  generateFleetReport,
  generateDriverReport,
} = require('../services/reportCalculationService');

const router = express.Router();

// Enforce authentication & 'Report' page permission (Admins automatically pass via auth middleware)
router.use(verifyToken, checkPageAccess('Report'));

// GET /api/reports/options - Retrieve selectable vehicles & drivers for filter dropdowns
router.get('/options', async (req, res) => {
  try {
    const [vehicles, drivers] = await Promise.all([
      Vehicle.find().select('vehicleNumber status').sort({ vehicleNumber: 1 }),
      Driver.find().select('driverName dlNumber mobileNumber status').sort({ driverName: 1 }),
    ]);

    res.json({
      vehicles: vehicles.map((v) => ({
        id: v._id,
        vehicleNumber: v.vehicleNumber,
        status: v.status,
      })),
      drivers: drivers.map((d) => ({
        id: d._id,
        driverName: d.driverName,
        dlNumber: d.dlNumber,
        mobileNumber: d.mobileNumber,
        status: d.status,
      })),
    });
  } catch (error) {
    console.error('[Report Options Error]:', error);
    res.status(500).json({ error: 'Failed to retrieve filter options.' });
  }
});

// GET /api/reports/fleet - Generate Fleet Report
router.get('/fleet', async (req, res) => {
  try {
    const { fromDate, toDate, vehicleNumber } = req.query;

    if (!fromDate || !toDate) {
      return res.status(400).json({ error: 'Both From Date and To Date are mandatory.' });
    }

    const report = await generateFleetReport({
      fromDate,
      toDate,
      vehicleNumber: vehicleNumber || 'ALL',
    });

    res.json(report);
  } catch (error) {
    console.error('[Fleet Report Error]:', error);
    res.status(400).json({ error: error.message || 'Failed to generate fleet report.' });
  }
});

// GET /api/reports/drivers - Generate Drivers Report
router.get('/drivers', async (req, res) => {
  try {
    const { fromDate, toDate, driverId } = req.query;

    if (!fromDate || !toDate) {
      return res.status(400).json({ error: 'Both From Date and To Date are mandatory.' });
    }

    const report = await generateDriverReport({
      fromDate,
      toDate,
      driverId: driverId || 'ALL',
    });

    res.json(report);
  } catch (error) {
    console.error('[Driver Report Error]:', error);
    res.status(400).json({ error: error.message || 'Failed to generate driver report.' });
  }
});

// GET /api/reports/export - Export Report as Excel .xlsx File
router.get('/export', async (req, res) => {
  try {
    const { reportType, fromDate, toDate, vehicleNumber, driverId } = req.query;

    if (!fromDate || !toDate) {
      return res.status(400).send('Both From Date and To Date are mandatory.');
    }

    const isDrivers = reportType === 'Drivers';
    let dataRows = [];
    let filename = '';

    if (isDrivers) {
      const result = await generateDriverReport({
        fromDate,
        toDate,
        driverId: driverId || 'ALL',
      });
      filename = `Sikka_Drivers_Report_${result.dateRange.displayFrom}_to_${result.dateRange.displayTo}.xlsx`;

      dataRows = result.rows.map((r) => ({
        'Driver Name': r.driverName,
        'DL Number': r.dlNumber,
        'Mobile Number': r.mobileNumber,
        'Date': r.date,
        'Salt Plant Stay Hour': r.saltPlantStay,
        'Tea Plant Stay Hour': r.teaPlantStay,
        'Dasna Plant Stay Hour': r.dasnaPlantStay,
        'Outside Total Hour': r.outsideTotal,
      }));
    } else {
      const result = await generateFleetReport({
        fromDate,
        toDate,
        vehicleNumber: vehicleNumber || 'ALL',
      });
      filename = `Sikka_Fleet_Report_${result.dateRange.displayFrom}_to_${result.dateRange.displayTo}.xlsx`;

      dataRows = result.rows.map((r) => ({
        'Vehicle Number': r.vehicleNumber,
        'Date': r.date,
        'Salt Plant Stay Hour': r.saltPlantStay,
        'Tea Plant Stay Hour': r.teaPlantStay,
        'Dasna Plant Stay Hour': r.dasnaPlantStay,
        'Outside Total Hour': r.outsideTotal,
      }));
    }

    // Build XLSX workbook
    const worksheet = XLSX.utils.json_to_sheet(dataRows);

    // Auto-fit column widths
    const colKeys = dataRows.length > 0 ? Object.keys(dataRows[0]) : [];
    worksheet['!cols'] = colKeys.map((key) => ({
      wch: Math.max(key.length + 4, 16),
    }));

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, isDrivers ? 'Drivers Report' : 'Fleet Report');

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (error) {
    console.error('[Export Report Error]:', error);
    res.status(500).send('Failed to export report.');
  }
});

module.exports = router;

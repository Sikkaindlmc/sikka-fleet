'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Truck,
  Users,
  Calendar,
  FileSpreadsheet,
  Download,
  RotateCcw,
  Play,
  Clock,
  Building2,
  MapPin,
  CheckCircle2,
  AlertCircle,
  Search,
  Filter,
  CreditCard,
  Phone,
  RefreshCw,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import AppLayout from '../../components/AppLayout';
import AlertBanner, { AlertState } from '../../components/AlertBanner';
import { apiRequest, API_BASE_URL } from '../../lib/api';

interface VehicleOption {
  id: string;
  vehicleNumber: string;
  status: string;
}

interface DriverOption {
  id: string;
  driverName: string;
  dlNumber: string;
  mobileNumber: string;
  status: string;
}

interface FleetReportRow {
  vehicleNumber: string;
  date: string;
  dateRaw: string;
  saltPlantStay: string;
  teaPlantStay: string;
  dasnaPlantStay: string;
  outsideTotal: string;
}

interface DriverReportRow {
  driverName: string;
  dlNumber: string;
  mobileNumber: string;
  date: string;
  dateRaw: string;
  saltPlantStay: string;
  teaPlantStay: string;
  dasnaPlantStay: string;
  outsideTotal: string;
}

export default function ReportPage() {
  const [reportType, setReportType] = useState<'Fleet' | 'Drivers'>('Fleet');

  // Filter options loaded from server
  const [vehicles, setVehicles] = useState<VehicleOption[]>([]);
  const [drivers, setDrivers] = useState<DriverOption[]>([]);
  const [isOptionsLoading, setIsOptionsLoading] = useState(true);

  // Form Filter State
  const [selectedVehicle, setSelectedVehicle] = useState('ALL');
  const [selectedDriver, setSelectedDriver] = useState('ALL');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  // Execution & Results State
  const [isRunning, setIsRunning] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [alert, setAlert] = useState<AlertState | null>(null);

  const [fleetReportRows, setFleetReportRows] = useState<FleetReportRow[] | null>(null);
  const [driverReportRows, setDriverReportRows] = useState<DriverReportRow[] | null>(null);
  const [activeDateRange, setActiveDateRange] = useState<{ displayFrom: string; displayTo: string } | null>(null);

  // Quick Table Search Filter
  const [tableSearch, setTableSearch] = useState('');

  // Set default date range to current month on initial mount
  useEffect(() => {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    // Default from 1st of current month to today
    setFromDate(`${y}-${m}-01`);
    setToDate(`${y}-${m}-${d}`);
  }, []);

  // Fetch filter dropdown options
  const fetchOptions = useCallback(async () => {
    try {
      setIsOptionsLoading(true);
      const data = await apiRequest<{
        vehicles: VehicleOption[];
        drivers: DriverOption[];
      }>('/reports/options');
      setVehicles(data.vehicles || []);
      setDrivers(data.drivers || []);
    } catch (err: any) {
      setAlert({
        type: 'error',
        message: err.message || 'Failed to load vehicle and driver options.',
      });
    } finally {
      setIsOptionsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOptions();
  }, [fetchOptions]);

  // Handle Reset (Blue Button)
  const handleReset = () => {
    if (reportType === 'Fleet') {
      setSelectedVehicle('ALL');
    } else {
      setSelectedDriver('ALL');
    }
    setFromDate('');
    setToDate('');
    setFleetReportRows(null);
    setDriverReportRows(null);
    setActiveDateRange(null);
    setTableSearch('');
    setAlert(null);
  };

  // Handle Run (Green Button)
  const handleRun = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setAlert(null);

    // 1. Mandatory Validations
    if (!fromDate.trim() || !toDate.trim()) {
      setAlert({
        type: 'error',
        message: 'Both From Date and To Date are mandatory for generating the report.',
      });
      return;
    }

    if (fromDate > toDate) {
      setAlert({
        type: 'error',
        message: 'From Date cannot be later than To Date.',
      });
      return;
    }

    setIsRunning(true);

    try {
      if (reportType === 'Fleet') {
        const queryParams = new URLSearchParams({
          fromDate: fromDate.trim(),
          toDate: toDate.trim(),
          vehicleNumber: selectedVehicle,
        });

        const res = await apiRequest<{
          reportType: string;
          dateRange: { displayFrom: string; displayTo: string };
          rows: FleetReportRow[];
        }>(`/reports/fleet?${queryParams.toString()}`);

        setFleetReportRows(res.rows || []);
        setDriverReportRows(null);
        setActiveDateRange(res.dateRange);
      } else {
        const queryParams = new URLSearchParams({
          fromDate: fromDate.trim(),
          toDate: toDate.trim(),
          driverId: selectedDriver,
        });

        const res = await apiRequest<{
          reportType: string;
          dateRange: { displayFrom: string; displayTo: string };
          rows: DriverReportRow[];
        }>(`/reports/drivers?${queryParams.toString()}`);

        setDriverReportRows(res.rows || []);
        setFleetReportRows(null);
        setActiveDateRange(res.dateRange);
      }
    } catch (err: any) {
      setAlert({
        type: 'error',
        message: err.message || 'Failed to generate report. Please try again.',
      });
    } finally {
      setIsRunning(false);
    }
  };

  // Export to Excel (.xlsx file format)
  const handleExportToExcel = () => {
    try {
      setIsExporting(true);

      if (reportType === 'Fleet' && fleetReportRows && fleetReportRows.length > 0) {
        const exportData = fleetReportRows.map((r) => ({
          'Vehicle Number': r.vehicleNumber,
          'Date': r.date,
          'Salt Plant Stay Hour': r.saltPlantStay,
          'Tea Plant Stay Hour': r.teaPlantStay,
          'Dasna Plant Stay Hour': r.dasnaPlantStay,
          'Outside Total Hour': r.outsideTotal,
        }));

        const ws = XLSX.utils.json_to_sheet(exportData);
        ws['!cols'] = [
          { wch: 18 }, // Vehicle Number
          { wch: 16 }, // Date
          { wch: 22 }, // Salt Plant Stay Hour
          { wch: 22 }, // Tea Plant Stay Hour
          { wch: 24 }, // Dasna Plant Stay Hour
          { wch: 20 }, // Outside Total Hour
        ];

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Fleet Report');

        const fromStr = activeDateRange ? activeDateRange.displayFrom : fromDate;
        const toStr = activeDateRange ? activeDateRange.displayTo : toDate;
        XLSX.writeFile(wb, `Sikka_Fleet_Report_${fromStr}_to_${toStr}.xlsx`);
      } else if (reportType === 'Drivers' && driverReportRows && driverReportRows.length > 0) {
        const exportData = driverReportRows.map((r) => ({
          'Driver Name': r.driverName,
          'DL Number': r.dlNumber,
          'Mobile Number': r.mobileNumber,
          'Date': r.date,
          'Salt Plant Stay Hour': r.saltPlantStay,
          'Tea Plant Stay Hour': r.teaPlantStay,
          'Dasna Plant Stay Hour': r.dasnaPlantStay,
          'Outside Total Hour': r.outsideTotal,
        }));

        const ws = XLSX.utils.json_to_sheet(exportData);
        ws['!cols'] = [
          { wch: 22 }, // Driver Name
          { wch: 18 }, // DL Number
          { wch: 16 }, // Mobile Number
          { wch: 16 }, // Date
          { wch: 22 }, // Salt Plant Stay Hour
          { wch: 22 }, // Tea Plant Stay Hour
          { wch: 24 }, // Dasna Plant Stay Hour
          { wch: 20 }, // Outside Total Hour
        ];

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Drivers Report');

        const fromStr = activeDateRange ? activeDateRange.displayFrom : fromDate;
        const toStr = activeDateRange ? activeDateRange.displayTo : toDate;
        XLSX.writeFile(wb, `Sikka_Drivers_Report_${fromStr}_to_${toStr}.xlsx`);
      }
    } catch (err: any) {
      setAlert({
        type: 'error',
        message: err.message || 'Failed to export Excel file.',
      });
    } finally {
      setIsExporting(false);
    }
  };

  // Filtered rows based on table search
  const filteredFleetRows = (fleetReportRows || []).filter((r) => {
    if (!tableSearch.trim()) return true;
    const q = tableSearch.toLowerCase();
    return r.vehicleNumber.toLowerCase().includes(q) || r.date.toLowerCase().includes(q);
  });

  const filteredDriverRows = (driverReportRows || []).filter((r) => {
    if (!tableSearch.trim()) return true;
    const q = tableSearch.toLowerCase();
    return (
      r.driverName.toLowerCase().includes(q) ||
      r.dlNumber.toLowerCase().includes(q) ||
      r.mobileNumber.toLowerCase().includes(q) ||
      r.date.toLowerCase().includes(q)
    );
  });

  const hasReport = reportType === 'Fleet' ? fleetReportRows !== null : driverReportRows !== null;
  const currentTotalRows = reportType === 'Fleet' ? (fleetReportRows?.length || 0) : (driverReportRows?.length || 0);

  return (
    <AppLayout pageTitle="Reports" requiredPage="Report">
      <div className="space-y-6">
        {/* Top Header & Report Type Selector */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-slate-200">
          <div>
            <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
              Stay Hours & Movement Report
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Calculates accurate stay durations inside Salt, Tea &amp; Dasna plants and outside movements from actual GPS telematics
            </p>
          </div>

          {/* Section 1: Report Type Selector (Fleet / Drivers) */}
          <div className="inline-flex p-1 bg-slate-200/80 rounded-2xl border border-slate-300/70 select-none shadow-2xs">
            <button
              type="button"
              onClick={() => {
                setReportType('Fleet');
                setTableSearch('');
              }}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                reportType === 'Fleet'
                  ? 'bg-white text-emerald-800 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Truck className={`w-4 h-4 ${reportType === 'Fleet' ? 'text-emerald-600' : 'text-slate-500'}`} />
              <span>Fleet</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setReportType('Drivers');
                setTableSearch('');
              }}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                reportType === 'Drivers'
                  ? 'bg-white text-emerald-800 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Users className={`w-4 h-4 ${reportType === 'Drivers' ? 'text-emerald-600' : 'text-slate-500'}`} />
              <span>Drivers</span>
            </button>
          </div>
        </div>

        {/* Feedback Alert */}
        <AlertBanner alert={alert} onDismiss={() => setAlert(null)} />

        {/* Filter Configuration Card */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 sm:p-6">
          <form onSubmit={handleRun}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Dynamic Target Selector: Vehicle Number OR Driver Name */}
              {reportType === 'Fleet' ? (
                <div>
                  <label
                    htmlFor="vehicle-select"
                    className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5"
                  >
                    Vehicle Number
                  </label>
                  <select
                    id="vehicle-select"
                    value={selectedVehicle}
                    onChange={(e) => setSelectedVehicle(e.target.value)}
                    disabled={isOptionsLoading || isRunning}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs font-bold text-slate-900 bg-white focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-hidden"
                  >
                    <option value="ALL">All Vehicles</option>
                    {vehicles.map((v) => (
                      <option key={v.id} value={v.vehicleNumber}>
                        {v.vehicleNumber} {v.status === 'Inactive' ? '(Inactive)' : ''}
                      </option>
                    ))}
                  </select>
                  <span className="text-[10px] text-slate-400 mt-1 block">
                    Choose All Vehicles or select an individual vehicle
                  </span>
                </div>
              ) : (
                <div>
                  <label
                    htmlFor="driver-select"
                    className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5"
                  >
                    Driver Name
                  </label>
                  <select
                    id="driver-select"
                    value={selectedDriver}
                    onChange={(e) => setSelectedDriver(e.target.value)}
                    disabled={isOptionsLoading || isRunning}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs font-bold text-slate-900 bg-white focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-hidden"
                  >
                    <option value="ALL">All Drivers</option>
                    {drivers.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.driverName} ({d.dlNumber})
                      </option>
                    ))}
                  </select>
                  <span className="text-[10px] text-slate-400 mt-1 block">
                    Choose All Drivers or select an individual driver
                  </span>
                </div>
              )}

              {/* Date Range: From Date */}
              <div>
                <label
                  htmlFor="from-date-input"
                  className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5"
                >
                  From Date <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <input
                    id="from-date-input"
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    disabled={isRunning}
                    required
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs font-semibold text-slate-800 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-hidden"
                  />
                </div>
                <span className="text-[10px] text-slate-400 mt-1 block">
                  Inclusive start date for calculation
                </span>
              </div>

              {/* Date Range: To Date */}
              <div>
                <label
                  htmlFor="to-date-input"
                  className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5"
                >
                  To Date <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <input
                    id="to-date-input"
                    type="date"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                    disabled={isRunning}
                    required
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs font-semibold text-slate-800 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-hidden"
                  />
                </div>
                <span className="text-[10px] text-slate-400 mt-1 block">
                  Inclusive end date for calculation
                </span>
              </div>
            </div>

            {/* Section 9: Footer Action Buttons (Reset = Blue, Run = Green) */}
            <div className="flex items-center justify-end gap-3 pt-5 mt-5 border-t border-slate-100">
              {/* Reset – Blue Button */}
              <button
                type="button"
                onClick={handleReset}
                disabled={isRunning}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-xs font-bold rounded-xl shadow-xs transition cursor-pointer disabled:opacity-50"
                title="Reset all filter fields and clear report"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset</span>
              </button>

              {/* Run – Green Button */}
              <button
                type="submit"
                disabled={isRunning}
                className="inline-flex items-center gap-2 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-xs font-bold rounded-xl shadow-xs shadow-emerald-600/20 transition cursor-pointer disabled:opacity-50"
                title="Generate stay hours report"
              >
                {isRunning ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Calculating Report...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Run Report</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>

        {/* Generated Report Card */}
        {hasReport && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            {/* Report Header: Meta & Export to Excel (Section 10) */}
            <div className="px-6 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-slate-50/50">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold">
                  {reportType === 'Fleet' ? <Truck className="w-5 h-5" /> : <Users className="w-5 h-5" />}
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                    <span>{reportType} Stay Hours Report</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-extrabold normal-case">
                      {currentTotalRows} records
                    </span>
                  </h2>
                  {activeDateRange && (
                    <p className="text-[11px] text-slate-500 font-medium">
                      Date Range: <strong className="text-slate-700">{activeDateRange.displayFrom}</strong> to{' '}
                      <strong className="text-slate-700">{activeDateRange.displayTo}</strong> (Inclusive)
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-3">
                {/* Search within Report */}
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={tableSearch}
                    onChange={(e) => setTableSearch(e.target.value)}
                    placeholder="Search in report..."
                    className="pl-8 pr-3 py-1.5 rounded-xl border border-slate-300 text-xs font-medium focus:border-emerald-500 focus:outline-hidden bg-white w-44 sm:w-56"
                  />
                </div>

                {/* Section 10: Export to Excel Button (.xlsx) */}
                <button
                  type="button"
                  onClick={handleExportToExcel}
                  disabled={isExporting || currentTotalRows === 0}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-xs font-bold rounded-xl shadow-xs transition cursor-pointer disabled:opacity-50 shrink-0"
                  title="Export current report to Excel (.xlsx)"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  <span>{isExporting ? 'Exporting...' : 'Export to Excel'}</span>
                </button>
              </div>
            </div>

            {/* Section 2: Fleet Report Table */}
            {reportType === 'Fleet' && (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 font-bold uppercase tracking-wider">
                    <tr>
                      <th className="px-6 py-3.5">Vehicle Number</th>
                      <th className="px-6 py-3.5">Date</th>
                      <th className="px-6 py-3.5 text-right">Salt Plant Stay Hour</th>
                      <th className="px-6 py-3.5 text-right">Tea Plant Stay Hour</th>
                      <th className="px-6 py-3.5 text-right">Dasna Plant Stay Hour</th>
                      <th className="px-6 py-3.5 text-right">Outside Total Hour</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    {filteredFleetRows.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-6 py-10 text-center text-slate-400">
                          No matching records found for this query.
                        </td>
                      </tr>
                    ) : (
                      filteredFleetRows.map((row, idx) => (
                        <tr key={`${row.vehicleNumber}-${row.date}-${idx}`} className="hover:bg-slate-50/80 transition">
                          <td className="px-6 py-3.5 font-bold text-slate-900">
                            <div className="flex items-center gap-2 font-mono">
                              <Truck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                              <span>{row.vehicleNumber}</span>
                            </div>
                          </td>
                          <td className="px-6 py-3.5 text-slate-700 font-semibold whitespace-nowrap">
                            {row.date}
                          </td>
                          <td className="px-6 py-3.5 text-right font-mono font-bold whitespace-nowrap">
                            <span
                              className={`px-2.5 py-1 rounded-lg ${
                                row.saltPlantStay !== '00:00'
                                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                  : 'text-slate-400'
                              }`}
                            >
                              {row.saltPlantStay}
                            </span>
                          </td>
                          <td className="px-6 py-3.5 text-right font-mono font-bold whitespace-nowrap">
                            <span
                              className={`px-2.5 py-1 rounded-lg ${
                                row.teaPlantStay !== '00:00'
                                  ? 'bg-teal-50 text-teal-800 border border-teal-200'
                                  : 'text-slate-400'
                              }`}
                            >
                              {row.teaPlantStay}
                            </span>
                          </td>
                          <td className="px-6 py-3.5 text-right font-mono font-bold whitespace-nowrap">
                            <span
                              className={`px-2.5 py-1 rounded-lg ${
                                row.dasnaPlantStay !== '00:00'
                                  ? 'bg-sky-50 text-sky-800 border border-sky-200'
                                  : 'text-slate-400'
                              }`}
                            >
                              {row.dasnaPlantStay}
                            </span>
                          </td>
                          <td className="px-6 py-3.5 text-right font-mono font-bold whitespace-nowrap">
                            <span
                              className={`px-2.5 py-1 rounded-lg ${
                                row.outsideTotal !== '00:00'
                                  ? 'bg-amber-50 text-amber-800 border border-amber-200'
                                  : 'text-slate-400'
                              }`}
                            >
                              {row.outsideTotal}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* Section 3: Driver Report Table */}
            {reportType === 'Drivers' && (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 font-bold uppercase tracking-wider">
                    <tr>
                      <th className="px-6 py-3.5">Driver Name</th>
                      <th className="px-6 py-3.5">DL Number</th>
                      <th className="px-6 py-3.5">Mobile Number</th>
                      <th className="px-6 py-3.5">Date</th>
                      <th className="px-6 py-3.5 text-right">Salt Plant Stay Hour</th>
                      <th className="px-6 py-3.5 text-right">Tea Plant Stay Hour</th>
                      <th className="px-6 py-3.5 text-right">Dasna Plant Stay Hour</th>
                      <th className="px-6 py-3.5 text-right">Outside Total Hour</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    {filteredDriverRows.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-6 py-10 text-center text-slate-400">
                          No matching driver records found for this query.
                        </td>
                      </tr>
                    ) : (
                      filteredDriverRows.map((row, idx) => (
                        <tr key={`${row.dlNumber}-${row.date}-${idx}`} className="hover:bg-slate-50/80 transition">
                          <td className="px-6 py-3.5 font-bold text-slate-900">
                            {row.driverName}
                          </td>
                          <td className="px-6 py-3.5 text-slate-700 font-mono font-bold">
                            <div className="flex items-center gap-1.5 bg-slate-100 px-2 py-0.5 rounded-md w-fit">
                              <CreditCard className="w-3 h-3 text-slate-500" />
                              <span>{row.dlNumber}</span>
                            </div>
                          </td>
                          <td className="px-6 py-3.5 text-slate-700 font-mono font-semibold whitespace-nowrap">
                            <div className="flex items-center gap-1">
                              <span className="text-[10px] px-1 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 font-bold">
                                +91
                              </span>
                              <span>{row.mobileNumber}</span>
                            </div>
                          </td>
                          <td className="px-6 py-3.5 text-slate-700 font-semibold whitespace-nowrap">
                            {row.date}
                          </td>
                          <td className="px-6 py-3.5 text-right font-mono font-bold whitespace-nowrap">
                            <span
                              className={`px-2.5 py-1 rounded-lg ${
                                row.saltPlantStay !== '00:00'
                                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                  : 'text-slate-400'
                              }`}
                            >
                              {row.saltPlantStay}
                            </span>
                          </td>
                          <td className="px-6 py-3.5 text-right font-mono font-bold whitespace-nowrap">
                            <span
                              className={`px-2.5 py-1 rounded-lg ${
                                row.teaPlantStay !== '00:00'
                                  ? 'bg-teal-50 text-teal-800 border border-teal-200'
                                  : 'text-slate-400'
                              }`}
                            >
                              {row.teaPlantStay}
                            </span>
                          </td>
                          <td className="px-6 py-3.5 text-right font-mono font-bold whitespace-nowrap">
                            <span
                              className={`px-2.5 py-1 rounded-lg ${
                                row.dasnaPlantStay !== '00:00'
                                  ? 'bg-sky-50 text-sky-800 border border-sky-200'
                                  : 'text-slate-400'
                              }`}
                            >
                              {row.dasnaPlantStay}
                            </span>
                          </td>
                          <td className="px-6 py-3.5 text-right font-mono font-bold whitespace-nowrap">
                            <span
                              className={`px-2.5 py-1 rounded-lg ${
                                row.outsideTotal !== '00:00'
                                  ? 'bg-amber-50 text-amber-800 border border-amber-200'
                                  : 'text-slate-400'
                              }`}
                            >
                              {row.outsideTotal}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  );
}

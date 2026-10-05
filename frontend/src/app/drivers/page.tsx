'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  UserCheck,
  Plus,
  Edit2,
  Search,
  Filter,
  Phone,
  Calendar,
  CreditCard,
  AlertCircle,
  CheckCircle2,
  X,
  RefreshCw,
  Trash2,
  Navigation,
  MapPin,
  ExternalLink,
  Clock,
  Radio,
  XCircle,
} from 'lucide-react';
import AppLayout from '../../components/AppLayout';
import Modal from '../../components/Modal';
import AlertBanner, { AlertState } from '../../components/AlertBanner';
import { apiRequest } from '../../lib/api';
import { useAuth } from '../../lib/authContext';

export interface DriverItem {
  _id: string;
  driverName: string;
  dlNumber: string;
  dob: string;
  mobileNumber: string;
  countryCode: string;
  status: 'Active' | 'Inactive';
  lastLoginAt?: string | null;
  currentStatus?: 'Inside' | 'Outside';
  currentPlantName?: string | null;
  currentPlantInTime?: string | null;
  lastPlantOutTime?: string | null;
  lastLocation?: {
    latitude: number;
    longitude: number;
    accuracy?: number | null;
    capturedAt?: string | null;
  } | null;
  lastLocationUpdateAt?: string | null;
  locationDeductionStatus?: 'Location Deducted' | 'Location Not Deducted';
  createdAt?: string;
  updatedAt?: string;
}

export default function DriverRegistryPage() {
  const { user } = useAuth();

  const [drivers, setDrivers] = useState<DriverItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAutoRefreshing, setIsAutoRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date>(new Date());
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | 'Active' | 'Inactive'>('All');
  const [alert, setAlert] = useState<AlertState | null>(null);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'add' | 'edit'>('add');
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  // Form Fields
  const [driverName, setDriverName] = useState('');
  const [dlNumber, setDlNumber] = useState('');
  const [dob, setDob] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');
  const [status, setStatus] = useState<'Active' | 'Inactive'>('Active');

  // Fetch Drivers with 20-minute silent background refresh support
  const fetchDrivers = useCallback(async (showSpinner = true) => {
    if (showSpinner) setIsLoading(true);
    else setIsAutoRefreshing(true);
    try {
      const data = await apiRequest<{ totalCount: number; drivers: DriverItem[] }>('/drivers');
      setDrivers(data.drivers || []);
      setLastRefreshedAt(new Date());
    } catch (err: any) {
      if (showSpinner) {
        setAlert({
          type: 'error',
          message: err.message || 'Failed to load driver registry.',
        });
      }
    } finally {
      if (showSpinner) setIsLoading(false);
      setIsAutoRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchDrivers(true);

    // Auto-refresh every 20 minutes (1,200,000 ms)
    const interval = setInterval(() => {
      fetchDrivers(false);
    }, 20 * 60 * 1000);

    return () => clearInterval(interval);
  }, [fetchDrivers]);

  // Open Add Driver Modal
  const openAddModal = () => {
    setModalMode('add');
    setSelectedDriverId(null);
    setDriverName('');
    setDlNumber('');
    setDob('');
    setMobileNumber('');
    setStatus('Active');
    setFormError('');
    setIsModalOpen(true);
  };

  // Open Edit Driver Modal
  const openEditModal = (driver: DriverItem) => {
    setModalMode('edit');
    setSelectedDriverId(driver._id);
    setDriverName(driver.driverName);
    setDlNumber(driver.dlNumber);
    // Format DOB to YYYY-MM-DD for date input
    const formattedDob = driver.dob ? new Date(driver.dob).toISOString().split('T')[0] : '';
    setDob(formattedDob);
    setMobileNumber(driver.mobileNumber);
    setStatus(driver.status);
    setFormError('');
    setIsModalOpen(true);
  };

  // Validate Indian 10-digit mobile number
  const validateMobile = (mobile: string): boolean => {
    const cleaned = mobile.replace(/\D/g, '');
    return /^[6-9]\d{9}$/.test(cleaned);
  };

  // Handle Form Submit (Add or Edit)
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    // Field Validations
    if (!driverName.trim()) {
      setFormError('Driver Name is required.');
      return;
    }

    if (!dlNumber.trim()) {
      setFormError('DL Number is required.');
      return;
    }

    if (!dob) {
      setFormError('Date of Birth (DOB) is required.');
      return;
    }

    const cleanedMobile = mobileNumber.replace(/\D/g, '');
    if (!cleanedMobile) {
      setFormError('Mobile Number is required.');
      return;
    }

    if (!validateMobile(cleanedMobile)) {
      setFormError('Please enter a valid 10-digit Indian mobile number (e.g. 9876543210).');
      return;
    }

    const cleanedDl = dlNumber.trim().toUpperCase();

    // Prevent duplicate DL Number
    const duplicateDl = drivers.find(
      (d) =>
        d.dlNumber.trim().toUpperCase() === cleanedDl &&
        (modalMode === 'add' || d._id !== selectedDriverId)
    );
    if (duplicateDl) {
      setFormError(
        `DL Number "${cleanedDl}" is already registered to driver "${duplicateDl.driverName}". Duplicate DL numbers are not allowed.`
      );
      return;
    }

    // Prevent duplicate Mobile Number
    const duplicateMobile = drivers.find(
      (d) =>
        d.mobileNumber.replace(/\D/g, '') === cleanedMobile &&
        (modalMode === 'add' || d._id !== selectedDriverId)
    );
    if (duplicateMobile) {
      setFormError(
        `Mobile Number "${cleanedMobile}" is already registered to driver "${duplicateMobile.driverName}". Duplicate mobile numbers are not allowed.`
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        driverName: driverName.trim(),
        dlNumber: cleanedDl,
        dob,
        mobileNumber: cleanedMobile,
        status,
      };

      if (modalMode === 'add') {
        const res = await apiRequest<{ message: string; driver: DriverItem }>('/drivers', {
          method: 'POST',
          body: JSON.stringify(payload),
        });

        setDrivers((prev) => [res.driver, ...prev]);
        setAlert({
          type: 'success',
          message: `Driver '${res.driver.driverName}' added to registry successfully.`,
        });
      } else {
        const res = await apiRequest<{ message: string; driver: DriverItem }>(
          `/drivers/${selectedDriverId}`,
          {
            method: 'PUT',
            body: JSON.stringify(payload),
          }
        );

        setDrivers((prev) =>
          prev.map((d) => (d._id === selectedDriverId ? res.driver : d))
        );
        setAlert({
          type: 'success',
          message: `Driver '${res.driver.driverName}' updated successfully.`,
        });
      }

      setIsModalOpen(false);
    } catch (err: any) {
      setFormError(err.message || 'Failed to save driver record.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Format Date for table display
  const formatDateDisplay = (dateStr: string) => {
    if (!dateStr) return '—';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  // Filter Drivers
  const filteredDrivers = drivers.filter((driver) => {
    const matchesSearch =
      driver.driverName.toLowerCase().includes(searchQuery.toLowerCase().trim()) ||
      driver.dlNumber.toLowerCase().includes(searchQuery.toLowerCase().trim()) ||
      driver.mobileNumber.includes(searchQuery.trim());

    if (!matchesSearch) return false;

    if (statusFilter !== 'All' && driver.status !== statusFilter) {
      return false;
    }

    return true;
  });

  return (
    <AppLayout pageTitle="Driver Registry" requiredPage="Driver Registry">
      <div className="space-y-6">
        {/* Header Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-slate-200">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
              <UserCheck className="w-4 h-4 text-emerald-600" />
              <span>Fleet Operations • Personnel</span>
            </div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">
              Driver Registry
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Manage authorized fleet drivers, driving license numbers, and Indian mobile login credentials.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Live 20-Min Auto-Sync Indicator */}
            <div
              className="hidden sm:inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-semibold shadow-2xs"
              title="Driver location records auto-update every 20 minutes"
            >
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span>20-Min Auto-Sync</span>
              <span className="text-[10px] text-emerald-600 font-mono">
                {lastRefreshedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>

            <button
              type="button"
              onClick={() => fetchDrivers(true)}
              disabled={isLoading || isAutoRefreshing}
              className="inline-flex items-center gap-2 px-3.5 py-2.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 text-xs font-bold rounded-xl shadow-xs transition cursor-pointer"
              title="Refresh Driver List Now"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading || isAutoRefreshing ? 'animate-spin text-emerald-600' : ''}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>

            {/* Required "Add Driver" Button */}
            <button
              type="button"
              onClick={openAddModal}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 text-slate-950 text-xs font-bold rounded-xl shadow-md shadow-emerald-500/20 transition cursor-pointer"
            >
              <Plus className="w-4 h-4 stroke-[2.5]" />
              <span>Add Driver</span>
            </button>
          </div>
        </div>

        {/* Feedback Alert */}
        <AlertBanner alert={alert} onDismiss={() => setAlert(null)} />

        {/* Summary Stats Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
            <span className="text-[10px] font-bold uppercase text-slate-400 block tracking-wider">
              Total Registered
            </span>
            <span className="text-2xl font-black text-slate-900 mt-1 block">
              {drivers.length}
            </span>
          </div>

          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
            <span className="text-[10px] font-bold uppercase text-emerald-600 block tracking-wider">
              Active Drivers
            </span>
            <span className="text-2xl font-black text-emerald-700 mt-1 block">
              {drivers.filter((d) => d.status === 'Active').length}
            </span>
          </div>

          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
            <span className="text-[10px] font-bold uppercase text-teal-600 block tracking-wider">
              Inside Plant
            </span>
            <span className="text-2xl font-black text-teal-700 mt-1 block">
              {drivers.filter((d) => d.currentStatus === 'Inside').length}
            </span>
          </div>

          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
            <span className="text-[10px] font-bold uppercase text-indigo-600 block tracking-wider">
              20-Min Auto-Sync
            </span>
            <div className="flex items-center gap-1.5 mt-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="text-xs font-bold text-slate-800">
                Active Cycle
              </span>
            </div>
            <span className="text-[10px] text-slate-400 font-mono block mt-0.5">
              Synced {lastRefreshedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        </div>

        {/* Filter and Search Bar */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name, DL number, or mobile..."
              className="w-full pl-9 pr-3.5 py-2 rounded-xl border border-slate-300 text-xs font-medium focus:border-emerald-500 focus:outline-hidden"
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Filter className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="text-xs font-bold text-slate-500">Status:</span>
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
              {(['All', 'Active', 'Inactive'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setStatusFilter(tab)}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                    statusFilter === tab
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Driver List Table */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50/80 border-b border-slate-200 text-slate-600 font-bold uppercase tracking-wider text-[11px]">
                <tr>
                  <th scope="col" className="px-5 py-3.5">
                    Driver Name
                  </th>
                  <th scope="col" className="px-5 py-3.5">
                    DL Number
                  </th>
                  <th scope="col" className="px-5 py-3.5">
                    Mobile
                  </th>
                  <th scope="col" className="px-5 py-3.5">
                    Live Geofence
                  </th>
                  <th scope="col" className="px-5 py-3.5">
                    Last GPS Location (20m)
                  </th>
                  <th scope="col" className="px-5 py-3.5">
                    Status
                  </th>
                  <th scope="col" className="px-5 py-3.5 text-right">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium text-slate-800">
                {isLoading ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-12 text-center text-slate-400">
                      <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-emerald-600" />
                      <span>Loading driver registry records...</span>
                    </td>
                  </tr>
                ) : filteredDrivers.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-12 text-center text-slate-400">
                      <UserCheck className="w-10 h-10 mx-auto mb-2 text-slate-300" />
                      <p className="font-semibold text-slate-700">No driver records found</p>
                      <p className="text-[11px] text-slate-500 mt-1">
                        {searchQuery || statusFilter !== 'All'
                          ? 'Try adjusting your search query or filter.'
                          : 'Get started by clicking "+ Add Driver" above.'}
                      </p>
                    </td>
                  </tr>
                ) : (
                  filteredDrivers.map((driver) => {
                    const isInside = driver.currentStatus === 'Inside';
                    const hasLocation = !!driver.lastLocation?.latitude && !!driver.lastLocation?.longitude;
                    const updateTimeStr = driver.lastLocationUpdateAt
                      ? new Date(driver.lastLocationUpdateAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                      : null;

                    return (
                      <tr
                        key={driver._id}
                        className="hover:bg-slate-50/80 transition-colors"
                      >
                        {/* Driver Name */}
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-slate-100 text-slate-700 font-bold flex items-center justify-center text-xs border border-slate-200 shrink-0">
                              {driver.driverName.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <span className="font-bold text-slate-900 block">
                                {driver.driverName}
                              </span>
                              <span className="text-[10px] text-slate-400 font-mono">
                                DOB: {formatDateDisplay(driver.dob)}
                              </span>
                            </div>
                          </div>
                        </td>

                        {/* DL Number */}
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-1.5 font-mono font-bold text-slate-900 bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-200/80 w-fit">
                            <CreditCard className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                            <span>{driver.dlNumber}</span>
                          </div>
                        </td>

                        {/* Mobile Number (+91 format) */}
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-1.5 font-semibold text-slate-800">
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200">
                              +91
                            </span>
                            <span className="font-mono">{driver.mobileNumber}</span>
                          </div>
                        </td>

                        {/* Live Geofence Status */}
                        <td className="px-5 py-4">
                          {isInside ? (
                            <div className="space-y-0.5">
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse" />
                                <span>Inside: {driver.currentPlantName || 'Plant'}</span>
                              </span>
                              {driver.currentPlantInTime && (
                                <span className="text-[10px] text-slate-400 block font-mono">
                                  In: {new Date(driver.currentPlantInTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-600">
                              <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                              <span>Outside Plants</span>
                            </span>
                          )}
                        </td>

                        {/* Last GPS Location (20-Min Periodic Cycle) */}
                        <td className="px-5 py-4">
                          {driver.locationDeductionStatus === 'Location Deducted' && hasLocation ? (
                            <div className="space-y-1">
                              <div className="flex items-center gap-1.5">
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-300">
                                  <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                  <span>Location Deducted</span>
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-mono font-bold text-slate-800">
                                  {driver.lastLocation!.latitude.toFixed(4)}, {driver.lastLocation!.longitude.toFixed(4)}
                                </span>
                                <a
                                  href={`https://maps.google.com/?q=${driver.lastLocation!.latitude},${driver.lastLocation!.longitude}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-0.5 text-[10px] font-bold text-emerald-600 hover:text-emerald-800 bg-emerald-50 hover:bg-emerald-100 px-1.5 py-0.5 rounded transition"
                                  title="Open in Google Maps"
                                >
                                  <MapPin className="w-3 h-3" />
                                  <span>Map</span>
                                  <ExternalLink className="w-2.5 h-2.5" />
                                </a>
                              </div>
                              <div className="flex items-center gap-1 text-[10px] text-slate-400">
                                <Clock className="w-3 h-3 text-slate-400" />
                                <span>Deducted: {updateTimeStr || 'Recent'}</span>
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-1">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-rose-100 text-rose-800 border border-rose-300">
                                <XCircle className="w-3 h-3 text-rose-600" />
                                <span>Location Not Deducted</span>
                              </span>
                              {hasLocation ? (
                                <p className="text-[10px] text-slate-400">
                                  Past fix at {updateTimeStr || 'Earlier'} (not current)
                                </p>
                              ) : (
                                <p className="text-[10px] text-slate-400 italic">
                                  No GPS received yet
                                </p>
                              )}
                            </div>
                          )}
                        </td>

                        {/* Account Status */}
                        <td className="px-5 py-4">
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold ${
                              driver.status === 'Active'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                driver.status === 'Active' ? 'bg-emerald-500' : 'bg-rose-500'
                              }`}
                            />
                            <span>{driver.status}</span>
                          </span>
                        </td>

                        {/* Action - Edit Option */}
                        <td className="px-5 py-4 text-right">
                          <button
                            type="button"
                            onClick={() => openEditModal(driver)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 text-xs font-bold rounded-xl transition cursor-pointer"
                            title="Edit Driver Details"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                            <span>Edit</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* POPUP MODAL: Add / Edit Driver */}
        <Modal
          isOpen={isModalOpen}
          onClose={() => !isSubmitting && setIsModalOpen(false)}
          title={modalMode === 'add' ? 'Add Driver' : 'Edit Driver'}
          subtitle={
            modalMode === 'add'
              ? 'Register an authorized fleet driver with DL and Indian mobile number.'
              : `Updating record for ${driverName || 'driver'}`
          }
          maxWidth="md"
        >
          {formError && (
            <div className="flex items-start gap-2.5 p-3.5 mb-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-medium animate-in fade-in duration-150">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{formError}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* 1. Driver Name */}
            <div>
              <label
                htmlFor="driver-name-input"
                className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1"
              >
                Driver Name <span className="text-rose-500">*</span>
              </label>
              <input
                id="driver-name-input"
                type="text"
                value={driverName}
                onChange={(e) => setDriverName(e.target.value)}
                placeholder="Enter full driver name (e.g. Ramesh Kumar)"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs font-medium focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-hidden"
                disabled={isSubmitting}
                required
              />
            </div>

            {/* 2. DL Number */}
            <div>
              <label
                htmlFor="dl-number-input"
                className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1"
              >
                DL Number <span className="text-rose-500">*</span>
              </label>
              <input
                id="dl-number-input"
                type="text"
                value={dlNumber}
                onChange={(e) => setDlNumber(e.target.value.toUpperCase())}
                placeholder="e.g. DL1420110012345"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs font-mono font-bold uppercase focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-hidden"
                disabled={isSubmitting}
                required
              />
              <span className="text-[10px] text-slate-400 mt-1 block">
                Unique Indian Driving License number. Used as Driver login username.
              </span>
            </div>

            {/* 3. DOB (Date Picker) */}
            <div>
              <label
                htmlFor="dob-input"
                className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1"
              >
                Date of Birth (DOB) <span className="text-rose-500">*</span>
              </label>
              <input
                id="dob-input"
                type="date"
                value={dob}
                onChange={(e) => setDob(e.target.value)}
                max={new Date().toISOString().split('T')[0]}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs font-medium focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-hidden"
                disabled={isSubmitting}
                required
              />
            </div>

            {/* 4. Mobile Number (Locked to +91 India, 10-digit validation) */}
            <div>
              <label
                htmlFor="mobile-input"
                className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1"
              >
                Mobile Number <span className="text-rose-500">*</span>
              </label>
              <div className="flex rounded-xl border border-slate-300 overflow-hidden focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500">
                <span className="inline-flex items-center gap-1 px-3 bg-slate-100 border-r border-slate-300 text-slate-700 font-bold text-xs select-none">
                  <span>🇮🇳</span>
                  <span>+91</span>
                </span>
                <input
                  id="mobile-input"
                  type="tel"
                  maxLength={10}
                  value={mobileNumber}
                  onChange={(e) => {
                    const onlyNums = e.target.value.replace(/\D/g, '');
                    setMobileNumber(onlyNums);
                  }}
                  placeholder="10-digit Indian mobile (e.g. 9876543210)"
                  className="w-full px-3.5 py-2.5 text-xs font-mono font-medium focus:outline-hidden"
                  disabled={isSubmitting}
                  required
                />
              </div>
              <span className="text-[10px] text-slate-400 mt-1 block">
                Must be an active 10-digit Indian mobile number. Used as Driver login password.
              </span>
            </div>

            {/* 5. Status */}
            <div>
              <label
                htmlFor="status-select"
                className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1"
              >
                Status <span className="text-rose-500">*</span>
              </label>
              <select
                id="status-select"
                value={status}
                onChange={(e) => setStatus(e.target.value as 'Active' | 'Inactive')}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs font-bold focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-hidden"
                disabled={isSubmitting}
              >
                <option value="Active">Active (Allowed to drive &amp; login)</option>
                <option value="Inactive">Inactive (Login blocked)</option>
              </select>
            </div>

            {/* Popup Footer Buttons: Cancel = Red, Save/Update = Blue */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                disabled={isSubmitting}
                className="px-4 py-2.5 bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white text-xs font-bold rounded-xl shadow-xs transition cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>

              <button
                type="submit"
                disabled={isSubmitting}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-xs font-bold rounded-xl shadow-md shadow-blue-500/20 transition cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Saving...</span>
                  </>
                ) : modalMode === 'add' ? (
                  <span>Save</span>
                ) : (
                  <span>Update</span>
                )}
              </button>
            </div>
          </form>
        </Modal>
      </div>
    </AppLayout>
  );
}

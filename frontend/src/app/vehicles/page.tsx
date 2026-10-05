'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Edit2, Truck, Phone, User, Building, AlertCircle, RefreshCw } from 'lucide-react';
import AppLayout from '../../components/AppLayout';
import Modal from '../../components/Modal';
import AlertBanner, { AlertState } from '../../components/AlertBanner';
import VehicleIcon from '../../components/VehicleIcon';
import { apiRequest } from '../../lib/api';
import { formatDateTime, clean10DigitPhone, normalizeVehicleNumber } from '../../lib/formatters';

interface VehicleRecord {
  _id: string;
  vehicleNumber: string;
  driverName: string;
  mobile: string;
  fleetType: 'Own Fleet' | 'Hired' | 'Rental';
  ownerName?: string;
  gpsDeviceId?: string;
  status: 'Active' | 'Inactive';
  createdAt: string;
  updatedAt: string;
}

export default function VehicleRegisterPage() {
  const [vehicles, setVehicles] = useState<VehicleRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [alert, setAlert] = useState<AlertState | null>(null);

  // Modal states
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleRecord | null>(null);

  // Form states
  const [formData, setFormData] = useState({
    vehicleNumber: '',
    driverName: '',
    mobileDigits: '', // 10 digits without +91 prefix
    fleetType: 'Own Fleet' as 'Own Fleet' | 'Hired' | 'Rental',
    ownerName: '',
    gpsDeviceId: '',
    status: 'Active' as 'Active' | 'Inactive',
  });
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchVehicles = useCallback(async () => {
    try {
      setIsLoading(true);
      const data = await apiRequest<VehicleRecord[]>('/vehicles');
      setVehicles(data || []);
    } catch (err: any) {
      setAlert({
        type: 'error',
        message: err.message || 'Failed to retrieve registered vehicles.',
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchVehicles();
  }, [fetchVehicles]);

  // Open Add Vehicle Modal
  const openCreateModal = () => {
    setFormData({
      vehicleNumber: '',
      driverName: '',
      mobileDigits: '',
      fleetType: 'Own Fleet',
      ownerName: '',
      gpsDeviceId: '',
      status: 'Active',
    });
    setFormError('');
    setIsCreateModalOpen(true);
  };

  // Open Edit Vehicle Modal
  const openEditModal = (vehicle: VehicleRecord) => {
    setSelectedVehicle(vehicle);
    // Extract 10 digits from '+91 9876543210'
    const rawDigits = vehicle.mobile ? clean10DigitPhone(vehicle.mobile) : '';

    setFormData({
      vehicleNumber: vehicle.vehicleNumber,
      driverName: vehicle.driverName,
      mobileDigits: rawDigits,
      fleetType: vehicle.fleetType,
      ownerName: vehicle.ownerName || '',
      gpsDeviceId: vehicle.gpsDeviceId || '',
      status: vehicle.status,
    });
    setFormError('');
    setIsEditModalOpen(true);
  };

  // Handle phone input changes (strictly 10 digits, auto-stripping non-digits)
  const handlePhoneChange = (val: string) => {
    const cleaned = clean10DigitPhone(val);
    setFormData({ ...formData, mobileDigits: cleaned });
  };

  // Handle Vehicle Number change (auto-uppercase and spaces removed)
  const handleVehicleNumberChange = (val: string) => {
    const cleaned = normalizeVehicleNumber(val);
    setFormData({ ...formData, vehicleNumber: cleaned });
  };

  // Submit Add Vehicle
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!formData.vehicleNumber.trim()) {
      setFormError('Vehicle number is required.');
      return;
    }
    if (formData.mobileDigits && formData.mobileDigits.length !== 10) {
      setFormError('Mobile number must be exactly 10 digits if provided.');
      return;
    }
    if (
      (formData.fleetType === 'Hired' || formData.fleetType === 'Rental') &&
      !formData.ownerName.trim()
    ) {
      setFormError(`Owner Name is required for '${formData.fleetType}' fleet vehicles.`);
      return;
    }

    setIsSubmitting(true);
    try {
      await apiRequest('/vehicles', {
        method: 'POST',
        body: JSON.stringify({
          vehicleNumber: formData.vehicleNumber.trim(),
          driverName: formData.driverName.trim(),
          mobile: formData.mobileDigits,
          fleetType: formData.fleetType,
          ownerName: formData.ownerName.trim(),
          gpsDeviceId: formData.gpsDeviceId.trim() || formData.vehicleNumber.trim(),
          status: formData.status,
        }),
      });

      setIsCreateModalOpen(false);
      setAlert({
        type: 'success',
        message: 'Vehicle created successfully.',
      });
      fetchVehicles();
    } catch (err: any) {
      setFormError(err.message || 'Failed to register vehicle.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Submit Edit Vehicle
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVehicle) return;
    setFormError('');

    if (!formData.vehicleNumber.trim()) {
      setFormError('Vehicle number is required.');
      return;
    }
    if (formData.mobileDigits && formData.mobileDigits.length !== 10) {
      setFormError('Mobile number must be exactly 10 digits if provided.');
      return;
    }
    if (
      (formData.fleetType === 'Hired' || formData.fleetType === 'Rental') &&
      !formData.ownerName.trim()
    ) {
      setFormError(`Owner Name is required for '${formData.fleetType}' fleet vehicles.`);
      return;
    }

    setIsSubmitting(true);
    try {
      await apiRequest(`/vehicles/${selectedVehicle._id}`, {
        method: 'PUT',
        body: JSON.stringify({
          vehicleNumber: formData.vehicleNumber.trim(),
          driverName: formData.driverName.trim(),
          mobile: formData.mobileDigits,
          fleetType: formData.fleetType,
          ownerName: formData.ownerName.trim(),
          gpsDeviceId: formData.gpsDeviceId.trim(),
          status: formData.status,
        }),
      });

      setIsEditModalOpen(false);
      setSelectedVehicle(null);
      setAlert({
        type: 'success',
        message: 'Vehicle updated successfully.',
      });
      fetchVehicles();
    } catch (err: any) {
      setFormError(err.message || 'Failed to update vehicle.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AppLayout pageTitle="Vehicle Register" requiredPage="Vehicle Register">
      <div className="space-y-6">
        {/* Header and Add Vehicle Action */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-slate-200">
          <div>
            <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
              Fleet Vehicle Registry
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Register commercial vehicles, drivers, phone numbers, and ownership types
            </p>
          </div>

          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 text-slate-950 text-xs font-bold rounded-xl shadow-xs transition cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>+ Add Vehicle</span>
          </button>
        </div>

        {/* Feedback Alert */}
        <AlertBanner alert={alert} onDismiss={() => setAlert(null)} />

        {/* Vehicle History Table */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider">
              Vehicle History ({vehicles.length})
            </h2>
            <button
              type="button"
              onClick={fetchVehicles}
              className="p-1 text-slate-400 hover:text-slate-700 rounded-md transition"
              title="Refresh vehicle list"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {isLoading ? (
            <div className="p-12 text-center text-slate-400">
              <RefreshCw className="w-7 h-7 animate-spin mx-auto mb-2 text-emerald-600" />
              <span className="text-xs font-semibold">Loading vehicle registry...</span>
            </div>
          ) : vehicles.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              <Truck className="w-10 h-10 text-slate-300 mx-auto mb-2" />
              <p className="text-sm font-semibold text-slate-700">No vehicles registered</p>
              <p className="text-xs text-slate-400 mt-1">
                Click &ldquo;+ Add Vehicle&rdquo; to enroll your first fleet vehicle.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 font-bold uppercase tracking-wider">
                  <tr>
                    <th className="px-6 py-3.5">Vehicle Number</th>
                    <th className="px-6 py-3.5">Driver Name</th>
                    <th className="px-6 py-3.5">Mobile</th>
                    <th className="px-6 py-3.5">Fleet Type</th>
                    <th className="px-6 py-3.5">Owner Name</th>
                    <th className="px-6 py-3.5">Status</th>
                    <th className="px-6 py-3.5">Created Date</th>
                    <th className="px-6 py-3.5">Updated Date</th>
                    <th className="px-6 py-3.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {vehicles.map((v) => (
                    <tr key={v._id} className="hover:bg-slate-50/70 transition">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <VehicleIcon className="w-4 h-4 text-emerald-600 shrink-0" />
                          <span className="font-extrabold text-slate-900 text-sm tracking-wide">
                            {v.vehicleNumber}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {v.driverName ? (
                          <div className="flex items-center gap-1.5 text-slate-800">
                            <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <span>{v.driverName}</span>
                          </div>
                        ) : (
                          <span className="text-slate-300 italic">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-slate-700 font-mono">
                        {v.mobile ? (
                          <div className="flex items-center gap-1.5">
                            <Phone className="w-3 h-3 text-slate-400" />
                            <span>{v.mobile}</span>
                          </div>
                        ) : (
                          <span className="text-slate-300 italic">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-100 text-slate-800">
                          {v.fleetType}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-slate-600">
                        {v.ownerName ? (
                          <div className="flex items-center gap-1">
                            <Building className="w-3 h-3 text-slate-400" />
                            <span>{v.ownerName}</span>
                          </div>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                            v.status === 'Active'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          {v.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-slate-500 text-[11px]">
                        {formatDateTime(v.createdAt)}
                      </td>
                      <td className="px-6 py-4 text-slate-500 text-[11px]">
                        {formatDateTime(v.updatedAt)}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          type="button"
                          onClick={() => openEditModal(v)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 hover:border-emerald-500 hover:bg-emerald-50 text-slate-700 hover:text-emerald-700 text-xs font-bold transition cursor-pointer"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                          <span>Edit</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Modal: Add Vehicle */}
        <Modal
          isOpen={isCreateModalOpen}
          onClose={() => !isSubmitting && setIsCreateModalOpen(false)}
          title="Add New Vehicle"
          subtitle="Enroll a new vehicle in the Sikka Fleet system"
        >
          {formError && (
            <div className="flex items-center gap-2 p-3 mb-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-medium">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          <form onSubmit={handleCreateSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Vehicle Number *
              </label>
              <input
                type="text"
                value={formData.vehicleNumber}
                onChange={(e) => handleVehicleNumberChange(e.target.value)}
                placeholder="e.g. UP14AB1234"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-bold uppercase tracking-wider focus:border-emerald-500 focus:outline-hidden"
                disabled={isSubmitting}
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Driver Name (Optional)
              </label>
              <input
                type="text"
                value={formData.driverName}
                onChange={(e) => setFormData({ ...formData, driverName: e.target.value })}
                placeholder="Leave blank or enter driver name"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-medium focus:border-emerald-500 focus:outline-hidden"
                disabled={isSubmitting}
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Mobile Number (Optional)
              </label>
              <div className="relative rounded-xl border border-slate-300 bg-white focus-within:border-emerald-500 flex items-center overflow-hidden">
                <span className="px-3.5 py-2.5 bg-slate-100 text-slate-600 font-bold text-sm border-r border-slate-200 select-none">
                  +91
                </span>
                <input
                  type="text"
                  maxLength={10}
                  value={formData.mobileDigits}
                  onChange={(e) => handlePhoneChange(e.target.value)}
                  placeholder="Optional 10-digit mobile"
                  className="w-full px-3 py-2.5 text-sm font-mono tracking-wider focus:outline-hidden"
                  disabled={isSubmitting}
                />
              </div>
              <span className="text-[11px] text-slate-500 mt-1 block">
                Stored automatically with country code: +91 {formData.mobileDigits || 'XXXXXXXXXX'}
              </span>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Fleet Type *
              </label>
              <select
                value={formData.fleetType}
                onChange={(e) => setFormData({ ...formData, fleetType: e.target.value as any })}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-medium focus:border-emerald-500 focus:outline-hidden bg-white"
                disabled={isSubmitting}
              >
                <option value="Own Fleet">Own Fleet</option>
                <option value="Hired">Hired</option>
                <option value="Rental">Rental</option>
              </select>
            </div>

            {/* Conditional Owner Name */}
            {(formData.fleetType === 'Hired' || formData.fleetType === 'Rental') && (
              <div className="animate-in fade-in duration-150">
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Owner Name *
                </label>
                <input
                  type="text"
                  value={formData.ownerName}
                  onChange={(e) => setFormData({ ...formData, ownerName: e.target.value })}
                  placeholder="e.g. Shri Ram Logistics"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-medium focus:border-emerald-500 focus:outline-hidden"
                  disabled={isSubmitting}
                  required
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Status
              </label>
              <select
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-medium focus:border-emerald-500 focus:outline-hidden bg-white"
                disabled={isSubmitting}
              >
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(false)}
                disabled={isSubmitting}
                className="px-4 py-2.5 text-xs font-bold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-xl transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-5 py-2.5 text-xs font-bold text-slate-950 bg-emerald-500 hover:bg-emerald-600 rounded-xl shadow-xs transition cursor-pointer disabled:opacity-50"
              >
                {isSubmitting ? 'Saving...' : 'Save Vehicle'}
              </button>
            </div>
          </form>
        </Modal>

        {/* Modal: Edit Vehicle */}
        <Modal
          isOpen={isEditModalOpen}
          onClose={() => !isSubmitting && setIsEditModalOpen(false)}
          title={`Edit Vehicle – ${selectedVehicle?.vehicleNumber || ''}`}
          subtitle="Update driver, phone number, fleet type, or status (historical GPS records preserved)"
        >
          {formError && (
            <div className="flex items-center gap-2 p-3 mb-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-medium">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          <form onSubmit={handleEditSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Vehicle Number *
              </label>
              <input
                type="text"
                value={formData.vehicleNumber}
                onChange={(e) => handleVehicleNumberChange(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-bold uppercase tracking-wider focus:border-emerald-500 focus:outline-hidden"
                disabled={isSubmitting}
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Driver Name (Optional)
              </label>
              <input
                type="text"
                value={formData.driverName}
                onChange={(e) => setFormData({ ...formData, driverName: e.target.value })}
                placeholder="Leave blank or enter driver name"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-medium focus:border-emerald-500 focus:outline-hidden"
                disabled={isSubmitting}
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Mobile Number (Optional)
              </label>
              <div className="relative rounded-xl border border-slate-300 bg-white focus-within:border-emerald-500 flex items-center overflow-hidden">
                <span className="px-3.5 py-2.5 bg-slate-100 text-slate-600 font-bold text-sm border-r border-slate-200 select-none">
                  +91
                </span>
                <input
                  type="text"
                  maxLength={10}
                  value={formData.mobileDigits}
                  onChange={(e) => handlePhoneChange(e.target.value)}
                  placeholder="Optional 10-digit mobile"
                  className="w-full px-3 py-2.5 text-sm font-mono tracking-wider focus:outline-hidden"
                  disabled={isSubmitting}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Fleet Type *
              </label>
              <select
                value={formData.fleetType}
                onChange={(e) => setFormData({ ...formData, fleetType: e.target.value as any })}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-medium focus:border-emerald-500 focus:outline-hidden bg-white"
                disabled={isSubmitting}
              >
                <option value="Own Fleet">Own Fleet</option>
                <option value="Hired">Hired</option>
                <option value="Rental">Rental</option>
              </select>
            </div>

            {(formData.fleetType === 'Hired' || formData.fleetType === 'Rental') && (
              <div className="animate-in fade-in duration-150">
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Owner Name *
                </label>
                <input
                  type="text"
                  value={formData.ownerName}
                  onChange={(e) => setFormData({ ...formData, ownerName: e.target.value })}
                  placeholder="e.g. Shri Ram Logistics"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-medium focus:border-emerald-500 focus:outline-hidden"
                  disabled={isSubmitting}
                  required
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Status
              </label>
              <select
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-medium focus:border-emerald-500 focus:outline-hidden bg-white"
                disabled={isSubmitting}
              >
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsEditModalOpen(false)}
                disabled={isSubmitting}
                className="px-4 py-2.5 text-xs font-bold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-xl transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-5 py-2.5 text-xs font-bold text-slate-950 bg-emerald-500 hover:bg-emerald-600 rounded-xl shadow-xs transition cursor-pointer disabled:opacity-50"
              >
                {isSubmitting ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        </Modal>
      </div>
    </AppLayout>
  );
}

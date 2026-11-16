'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Edit2, Building2, MapPin, Compass, AlertCircle, RefreshCw, CheckCircle2 } from 'lucide-react';
import AppLayout from '../../components/AppLayout';
import Modal from '../../components/Modal';
import AlertBanner, { AlertState } from '../../components/AlertBanner';
import { apiRequest } from '../../lib/api';
import { formatDateTime } from '../../lib/formatters';

interface PlantRecord {
  _id: string;
  plantName: string;
  location: string;
  radiusMeters?: number;
  radiusMeter?: number;
  latitude: number;
  longitude: number;
  status: 'Active' | 'Inactive';
  createdAt: string;
  updatedAt: string;
}

export default function PlantPage() {
  const [plants, setPlants] = useState<PlantRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [alert, setAlert] = useState<AlertState | null>(null);

  // Modal states
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedPlant, setSelectedPlant] = useState<PlantRecord | null>(null);

  // Form states
  const [createFormData, setCreateFormData] = useState({
    plantName: '',
    location: '',
    radiusMeter: '',
    latitude: '',
    longitude: '',
    status: 'Active' as 'Active' | 'Inactive',
  });

  const [editFormData, setEditFormData] = useState({
    plantName: '',
    location: '',
    radiusMeter: '',
    latitude: '',
    longitude: '',
    status: 'Active' as 'Active' | 'Inactive',
  });
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchPlants = useCallback(async () => {
    try {
      setIsLoading(true);
      const data = await apiRequest<PlantRecord[]>('/plants');
      setPlants(data || []);
    } catch (err: any) {
      setAlert({
        type: 'error',
        message: err.message || 'Failed to load plants from database.',
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPlants();
  }, [fetchPlants]);

  // Open Create Modal
  const openCreateModal = () => {
    setCreateFormData({
      plantName: '',
      location: '',
      radiusMeter: '',
      latitude: '',
      longitude: '',
      status: 'Active',
    });
    setFormError('');
    setIsCreateModalOpen(true);
  };

  // Open Edit Modal
  const openEditModal = (plant: PlantRecord) => {
    setSelectedPlant(plant);
    const radiusVal = plant.radiusMeters ?? plant.radiusMeter ?? '';
    setEditFormData({
      plantName: plant.plantName,
      location: plant.location,
      radiusMeter: String(radiusVal),
      latitude: String(plant.latitude),
      longitude: String(plant.longitude),
      status: plant.status,
    });
    setFormError('');
    setIsEditModalOpen(true);
  };

  // Handle Create Plant Submission
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!createFormData.plantName.trim()) {
      setFormError('Plant Name is required.');
      return;
    }
    if (!createFormData.location.trim()) {
      setFormError('Location is required.');
      return;
    }
    const radius = Number(createFormData.radiusMeter);
    if (isNaN(radius) || radius <= 0) {
      setFormError('Radius must be a positive number greater than 0.');
      return;
    }
    const lat = Number(createFormData.latitude);
    if (isNaN(lat) || lat < -90 || lat > 90) {
      setFormError('Latitude must be a valid number between -90 and 90.');
      return;
    }
    const lon = Number(createFormData.longitude);
    if (isNaN(lon) || lon < -180 || lon > 180) {
      setFormError('Longitude must be a valid number between -180 and 180.');
      return;
    }
    if (lat === 0 && lon === 0) {
      setFormError('Plant coordinates cannot be 0,0.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await apiRequest<{ message: string; plant: PlantRecord }>('/plants', {
        method: 'POST',
        body: JSON.stringify({
          plantName: createFormData.plantName.trim(),
          location: createFormData.location.trim(),
          radiusMeter: radius,
          radiusMeters: radius,
          latitude: lat,
          longitude: lon,
          status: createFormData.status,
        }),
      });

      setIsCreateModalOpen(false);
      setAlert({
        type: 'success',
        message: 'Plant created successfully.',
      });
      if (res && res.plant) {
        setPlants((prev) => [res.plant, ...prev.filter((p) => p._id !== res.plant._id)]);
      }
      fetchPlants();
    } catch (err: any) {
      setFormError(err.message || 'Failed to create plant.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Edit Plant Submission
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPlant) return;
    setFormError('');

    if (!editFormData.plantName.trim()) {
      setFormError('Plant Name is required.');
      return;
    }
    if (!editFormData.location.trim()) {
      setFormError('Location is required.');
      return;
    }
    const radius = Number(editFormData.radiusMeter);
    if (isNaN(radius) || radius <= 0) {
      setFormError('Radius must be greater than 0.');
      return;
    }
    const lat = Number(editFormData.latitude);
    if (isNaN(lat) || lat < -90 || lat > 90) {
      setFormError('Latitude must be between -90 and 90.');
      return;
    }
    const lon = Number(editFormData.longitude);
    if (isNaN(lon) || lon < -180 || lon > 180) {
      setFormError('Longitude must be between -180 and 180.');
      return;
    }
    if (lat === 0 && lon === 0) {
      setFormError('Plant coordinates cannot be 0,0.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await apiRequest<{ message: string; plant: PlantRecord }>(`/plants/${selectedPlant._id}`, {
        method: 'PUT',
        body: JSON.stringify({
          plantName: editFormData.plantName.trim(),
          location: editFormData.location.trim(),
          radiusMeter: radius,
          radiusMeters: radius,
          latitude: lat,
          longitude: lon,
          status: editFormData.status,
        }),
      });

      // Preserve user edit immediately in state so it cannot auto change or revert
      if (res && res.plant) {
        setPlants((prev) => prev.map((p) => (p._id === selectedPlant._id ? res.plant : p)));
      }
      setIsEditModalOpen(false);
      setSelectedPlant(null);
      setAlert({
        type: 'success',
        message: 'Plant updated successfully.',
      });
      fetchPlants();
    } catch (err: any) {
      setFormError(err.message || 'Failed to update plant.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AppLayout pageTitle="Plant Management" requiredPage="Plant">
      <div className="space-y-6">
        {/* Section 1: Page Header & Create Plant Action */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-slate-200">
          <div>
            <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
              Plant Geofence Registry
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Manage plant geofences, coordinates, radius, and operational statuses
            </p>
          </div>

          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 text-slate-950 text-xs font-bold rounded-xl shadow-xs transition cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Create Plant</span>
          </button>
        </div>

        {/* Feedback Alert */}
        <AlertBanner alert={alert} onDismiss={() => setAlert(null)} />

        {/* Section 2: Plant History Table */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider">
              Plant History ({plants.length})
            </h2>
            <button
              type="button"
              onClick={fetchPlants}
              className="p-1 text-slate-400 hover:text-slate-700 rounded-md transition"
              title="Refresh plants"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {isLoading ? (
            <div className="p-12 text-center text-slate-400">
              <RefreshCw className="w-7 h-7 animate-spin mx-auto mb-2 text-emerald-600" />
              <span className="text-xs font-semibold">Loading plant records...</span>
            </div>
          ) : plants.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              <Building2 className="w-10 h-10 text-slate-300 mx-auto mb-2" />
              <p className="text-sm font-semibold text-slate-700">No plants registered yet</p>
              <p className="text-xs text-slate-400 mt-1">
                Click the &ldquo;Create Plant&rdquo; button above to configure your first geofenced plant.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 font-bold uppercase tracking-wider">
                  <tr>
                    <th className="px-6 py-3.5">Plant Name</th>
                    <th className="px-6 py-3.5">Location</th>
                    <th className="px-6 py-3.5">Radius (Meter)</th>
                    <th className="px-6 py-3.5">Latitude</th>
                    <th className="px-6 py-3.5">Longitude</th>
                    <th className="px-6 py-3.5">Status</th>
                    <th className="px-6 py-3.5">Created Date</th>
                    <th className="px-6 py-3.5">Updated Date</th>
                    <th className="px-6 py-3.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {plants.map((plant) => (
                    <tr key={plant._id} className="hover:bg-slate-50/70 transition">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <Building2 className="w-4 h-4 text-emerald-600 shrink-0" />
                          <span className="font-bold text-slate-900 text-sm">
                            {plant.plantName}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-slate-700">
                        <div className="flex items-center gap-1 text-slate-600">
                          <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span className="truncate max-w-[200px]">{plant.location}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 font-bold text-slate-800">
                        {plant.radiusMeters ?? plant.radiusMeter} m
                      </td>
                      <td className="px-6 py-4 font-mono text-slate-600">
                        {plant.latitude.toFixed(6)}
                      </td>
                      <td className="px-6 py-4 font-mono text-slate-600">
                        {plant.longitude.toFixed(6)}
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                            plant.status === 'Active'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          {plant.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-slate-500 text-[11px]">
                        {formatDateTime(plant.createdAt)}
                      </td>
                      <td className="px-6 py-4 text-slate-500 text-[11px]">
                        {formatDateTime(plant.updatedAt)}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          type="button"
                          onClick={() => openEditModal(plant)}
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

        {/* Modal: Create Plant */}
        <Modal
          isOpen={isCreateModalOpen}
          onClose={() => !isSubmitting && setIsCreateModalOpen(false)}
          title="Create New Plant"
          subtitle="Define plant boundaries, geographic center coordinates, and detection radius"
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
                Plant Name *
              </label>
              <input
                type="text"
                value={createFormData.plantName}
                onChange={(e) => setCreateFormData({ ...createFormData, plantName: e.target.value })}
                placeholder="e.g. Tea Plant"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 text-sm font-semibold focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 focus:outline-hidden transition-all shadow-xs"
                disabled={isSubmitting}
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Location *
              </label>
              <input
                type="text"
                value={createFormData.location}
                onChange={(e) => setCreateFormData({ ...createFormData, location: e.target.value })}
                placeholder="e.g. Sector 62, Noida, UP"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 text-sm font-semibold focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 focus:outline-hidden transition-all shadow-xs"
                disabled={isSubmitting}
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Radius in Meter *
              </label>
              <input
                type="number"
                min="1"
                step="1"
                value={createFormData.radiusMeter}
                onChange={(e) => setCreateFormData({ ...createFormData, radiusMeter: e.target.value })}
                placeholder="Radius in meters"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 text-sm font-semibold focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 focus:outline-hidden transition-all shadow-xs"
                disabled={isSubmitting}
                required
              />
              <span className="text-[11px] text-slate-500 mt-1 block">
                Radius in meters (e.g. 500 means a 500-meter geofence perimeter around the plant).
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Latitude *
                </label>
                <input
                  type="number"
                  step="any"
                  value={createFormData.latitude}
                  onChange={(e) => setCreateFormData({ ...createFormData, latitude: e.target.value })}
                  placeholder="Verified latitude"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 text-sm font-mono font-semibold focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 focus:outline-hidden transition-all shadow-xs"
                  disabled={isSubmitting}
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Longitude *
                </label>
                <input
                  type="number"
                  step="any"
                  value={createFormData.longitude}
                  onChange={(e) => setCreateFormData({ ...createFormData, longitude: e.target.value })}
                  placeholder="Verified longitude"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 text-sm font-mono font-semibold focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 focus:outline-hidden transition-all shadow-xs"
                  disabled={isSubmitting}
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Status
              </label>
              <select
                value={createFormData.status}
                onChange={(e) => setCreateFormData({ ...createFormData, status: e.target.value as any })}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-slate-900 text-sm font-semibold focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 focus:outline-hidden transition-all shadow-xs cursor-pointer"
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
                {isSubmitting ? 'Saving...' : 'Save Plant'}
              </button>
            </div>
          </form>
        </Modal>

        {/* Modal: Edit Plant */}
        <Modal
          isOpen={isEditModalOpen}
          onClose={() => !isSubmitting && setIsEditModalOpen(false)}
          title={`Edit Plant – ${selectedPlant?.plantName || ''}`}
          subtitle="Modify plant name, location, geofence radius, coordinates, or active status"
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
                Plant Name *
              </label>
              <input
                type="text"
                value={editFormData.plantName}
                onChange={(e) => setEditFormData({ ...editFormData, plantName: e.target.value })}
                placeholder="Enter plant name"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 text-sm font-semibold focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 focus:outline-hidden transition-all shadow-xs"
                disabled={isSubmitting}
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Location *
              </label>
              <input
                type="text"
                value={editFormData.location}
                onChange={(e) => setEditFormData({ ...editFormData, location: e.target.value })}
                placeholder="Enter plant physical location"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 text-sm font-semibold focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 focus:outline-hidden transition-all shadow-xs"
                disabled={isSubmitting}
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Radius in Meter *
              </label>
              <input
                type="number"
                min="1"
                step="1"
                value={editFormData.radiusMeter}
                onChange={(e) => setEditFormData({ ...editFormData, radiusMeter: e.target.value })}
                placeholder="Radius in meters"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 text-sm font-semibold focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 focus:outline-hidden transition-all shadow-xs"
                disabled={isSubmitting}
                required
              />
              <span className="text-[11px] text-slate-500 mt-1 block">
                Radius in meters (e.g. 500 means a 500-meter circular geofence perimeter around the plant).
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Latitude *
                </label>
                <input
                  type="number"
                  step="any"
                  value={editFormData.latitude}
                  onChange={(e) => setEditFormData({ ...editFormData, latitude: e.target.value })}
                  placeholder="Verified latitude"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 text-sm font-mono font-semibold focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 focus:outline-hidden transition-all shadow-xs"
                  disabled={isSubmitting}
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Longitude *
                </label>
                <input
                  type="number"
                  step="any"
                  value={editFormData.longitude}
                  onChange={(e) => setEditFormData({ ...editFormData, longitude: e.target.value })}
                  placeholder="Verified longitude"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 text-sm font-mono font-semibold focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 focus:outline-hidden transition-all shadow-xs"
                  disabled={isSubmitting}
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Status
              </label>
              <select
                value={editFormData.status}
                onChange={(e) => setEditFormData({ ...editFormData, status: e.target.value as any })}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-slate-900 text-sm font-semibold focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 focus:outline-hidden transition-all shadow-xs cursor-pointer"
                disabled={isSubmitting}
              >
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
              {editFormData.status === 'Inactive' && (
                <p className="text-[11px] text-amber-600 mt-1 font-medium">
                  Note: Inactive plants will not participate in vehicle geofence matching. Existing historical records remain intact.
                </p>
              )}
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

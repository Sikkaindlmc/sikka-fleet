'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Plus,
  Edit2,
  Users,
  Shield,
  Eye,
  EyeOff,
  Building2,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Lock,
  Power,
} from 'lucide-react';
import AppLayout from '../../components/AppLayout';
import Modal from '../../components/Modal';
import ConfirmationModal from '../../components/ConfirmationModal';
import AlertBanner, { AlertState } from '../../components/AlertBanner';
import { NAV_ITEMS } from '../../components/Sidebar';
import { apiRequest } from '../../lib/api';
import { formatDateTime } from '../../lib/formatters';

interface PlantOption {
  _id: string;
  plantName: string;
  status: string;
}

interface UserRecord {
  _id: string;
  fullName: string;
  username: string;
  role: 'Admin' | 'User';
  accessPages: string[];
  accessPlants: Array<{ _id: string; plantName: string } | string>;
  status: 'Active' | 'Inactive';
  createdAt: string;
  updatedAt: string;
}

// Fallback system pages derived from central navigation
export const DEFAULT_SYSTEM_PAGES = NAV_ITEMS.map((item) => item.name);

export default function UserManagementPage() {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [activePlants, setActivePlants] = useState<PlantOption[]>([]);
  const [availablePages, setAvailablePages] = useState<string[]>(DEFAULT_SYSTEM_PAGES);
  const [isLoading, setIsLoading] = useState(true);
  const [alert, setAlert] = useState<AlertState | null>(null);

  // Modals
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserRecord | null>(null);

  // Status toggle confirmation
  const [statusModalOpen, setStatusModalOpen] = useState(false);
  const [userToToggle, setUserToToggle] = useState<UserRecord | null>(null);

  // Password visibility
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Form State
  const [formData, setFormData] = useState({
    fullName: '',
    username: '',
    role: 'User' as 'Admin' | 'User',
    password: '',
    confirmPassword: '',
    accessPlants: [] as string[],
    accessPages: ['Dashboard'] as string[],
    status: 'Active' as 'Active' | 'Inactive',
  });
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch Users, Plants & System Pages from MongoDB database
  const fetchData = useCallback(async () => {
    try {
      setIsLoading(true);
      const [usersData, plantsData, pagesData] = await Promise.all([
        apiRequest<UserRecord[]>('/users'),
        apiRequest<PlantOption[]>('/plants'),
        apiRequest<{ pages: string[] }>('/users/pages').catch(() => null),
      ]);
      setUsers(usersData || []);
      setActivePlants((plantsData || []).filter((p) => p.status === 'Active'));
      if (pagesData && Array.isArray(pagesData.pages) && pagesData.pages.length > 0) {
        setAvailablePages(pagesData.pages);
      }
    } catch (err: any) {
      setAlert({
        type: 'error',
        message: err.message || 'Failed to retrieve users.',
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Open Create Modal
  const openCreateModal = () => {
    setFormData({
      fullName: '',
      username: '',
      role: 'User',
      password: '',
      confirmPassword: '',
      accessPlants: activePlants.map((p) => p._id),
      accessPages: ['Dashboard', 'Plant'],
      status: 'Active',
    });
    setFormError('');
    setShowPassword(false);
    setShowConfirmPassword(false);
    setIsCreateModalOpen(true);
  };

  // Open Edit Modal
  const openEditModal = (user: UserRecord) => {
    setSelectedUser(user);
    const assignedPlantIds = (user.accessPlants || []).map((p) =>
      typeof p === 'string' ? p : p._id
    );

    const initialPages =
      user.role === 'Admin'
        ? Array.from(new Set([...(user.accessPages || []), ...availablePages]))
        : user.accessPages && user.accessPages.length > 0
        ? user.accessPages
        : ['Dashboard'];

    setFormData({
      fullName: user.fullName,
      username: user.username,
      role: user.role || 'User',
      password: '',
      confirmPassword: '',
      accessPlants: assignedPlantIds,
      accessPages: initialPages,
      status: user.status,
    });
    setFormError('');
    setShowPassword(false);
    setShowConfirmPassword(false);
    setIsEditModalOpen(true);
  };

  // Handle Role Change
  const handleRoleChange = (newRole: 'Admin' | 'User') => {
    setFormData((prev) => ({
      ...prev,
      role: newRole,
      accessPages: newRole === 'Admin' ? [...availablePages] : prev.accessPages,
    }));
  };

  // Toggle Page Checkbox
  const togglePage = (page: string) => {
    if (formData.role === 'Admin') return; // Admin always retains access to all pages
    setFormData((prev) => {
      const exists = prev.accessPages.includes(page);
      let updated = exists
        ? prev.accessPages.filter((p) => p !== page)
        : [...prev.accessPages, page];
      if (updated.length === 0) updated = ['Dashboard']; // At least 1 page
      return { ...prev, accessPages: updated };
    });
  };

  // Select all pages
  const selectAllPages = () => {
    setFormData((prev) => ({
      ...prev,
      accessPages: [...availablePages],
    }));
  };

  // Deselect all pages (reset to Dashboard)
  const deselectAllPages = () => {
    setFormData((prev) => ({
      ...prev,
      accessPages: ['Dashboard'],
    }));
  };

  // Toggle Plant Checkbox
  const togglePlant = (plantId: string) => {
    setFormData((prev) => {
      const exists = prev.accessPlants.includes(plantId);
      const updated = exists
        ? prev.accessPlants.filter((id) => id !== plantId)
        : [...prev.accessPlants, plantId];
      return { ...prev, accessPlants: updated };
    });
  };

  // Select all plants
  const selectAllPlants = () => {
    setFormData((prev) => ({
      ...prev,
      accessPlants: activePlants.map((p) => p._id),
    }));
  };

  // Create User Submit
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!formData.fullName.trim()) {
      setFormError('Full Name is required.');
      return;
    }
    if (!formData.username.trim()) {
      setFormError('Username is required.');
      return;
    }
    if (!formData.password) {
      setFormError('Password is required.');
      return;
    }
    if (formData.password !== formData.confirmPassword) {
      setFormError('Passwords do not match.');
      return;
    }
    if (formData.accessPages.length === 0) {
      setFormError('Select at least one accessible page.');
      return;
    }

    setIsSubmitting(true);
    try {
      await apiRequest('/users', {
        method: 'POST',
        body: JSON.stringify({
          fullName: formData.fullName.trim(),
          username: formData.username.trim().toLowerCase(),
          role: formData.role,
          password: formData.password,
          confirmPassword: formData.confirmPassword,
          accessPlants: formData.accessPlants,
          accessPages: formData.accessPages,
          status: formData.status,
        }),
      });

      setIsCreateModalOpen(false);
      setAlert({
        type: 'success',
        message: 'User created successfully.',
      });
      fetchData();
    } catch (err: any) {
      setFormError(err.message || 'Failed to create user.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Edit User Submit
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;
    setFormError('');

    if (!formData.fullName.trim()) {
      setFormError('Full Name is required.');
      return;
    }
    if (!formData.username.trim()) {
      setFormError('Username is required.');
      return;
    }
    if (formData.password && formData.password !== formData.confirmPassword) {
      setFormError('Passwords do not match.');
      return;
    }
    if (formData.accessPages.length === 0) {
      setFormError('Select at least one accessible page.');
      return;
    }

    setIsSubmitting(true);
    try {
      await apiRequest(`/users/${selectedUser._id}`, {
        method: 'PUT',
        body: JSON.stringify({
          fullName: formData.fullName.trim(),
          username: formData.username.trim().toLowerCase(),
          role: formData.role,
          password: formData.password || undefined,
          confirmPassword: formData.confirmPassword || undefined,
          accessPlants: formData.accessPlants,
          accessPages: formData.accessPages,
          status: formData.status,
        }),
      });

      setIsEditModalOpen(false);
      setSelectedUser(null);
      setAlert({
        type: 'success',
        message: 'User updated successfully.',
      });
      fetchData();
    } catch (err: any) {
      setFormError(err.message || 'Failed to update user.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Status Toggle (Activate / Deactivate)
  const confirmToggleStatus = (u: UserRecord) => {
    setUserToToggle(u);
    setStatusModalOpen(true);
  };

  const handleStatusToggle = async () => {
    if (!userToToggle) return;
    const newStatus = userToToggle.status === 'Active' ? 'Inactive' : 'Active';

    try {
      await apiRequest(`/users/${userToToggle._id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus }),
      });
      setStatusModalOpen(false);
      setUserToToggle(null);
      setAlert({
        type: 'success',
        message: `User ${newStatus === 'Active' ? 'activated' : 'deactivated'} successfully.`,
      });
      fetchData();
    } catch (err: any) {
      setAlert({
        type: 'error',
        message: err.message || 'Failed to change user status.',
      });
    }
  };

  return (
    <AppLayout pageTitle="User Management" requiredPage="User Management">
      <div className="space-y-6">
        {/* Header & Add User Action */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-slate-200">
          <div>
            <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
              User Access Management
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Control user accounts, page permissions, plant-level geofence access, and active credentials
            </p>
          </div>

          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 text-slate-950 text-xs font-bold rounded-xl shadow-xs transition cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>+ Add User</span>
          </button>
        </div>

        {/* Feedback Alert */}
        <AlertBanner alert={alert} onDismiss={() => setAlert(null)} />

        {/* User History Table */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider">
              User History ({users.length})
            </h2>
            <button
              type="button"
              onClick={fetchData}
              className="p-1 text-slate-400 hover:text-slate-700 rounded-md transition"
              title="Refresh users"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {isLoading ? (
            <div className="p-12 text-center text-slate-400">
              <RefreshCw className="w-7 h-7 animate-spin mx-auto mb-2 text-emerald-600" />
              <span className="text-xs font-semibold">Loading user accounts...</span>
            </div>
          ) : users.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              <Users className="w-10 h-10 text-slate-300 mx-auto mb-2" />
              <p className="text-sm font-semibold text-slate-700">No users found</p>
              <p className="text-xs text-slate-400 mt-1">
                Click &ldquo;+ Add User&rdquo; to create a new user profile.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 font-bold uppercase tracking-wider">
                  <tr>
                    <th className="px-6 py-3.5">Full Name</th>
                    <th className="px-6 py-3.5">Username</th>
                    <th className="px-6 py-3.5">Role</th>
                    <th className="px-6 py-3.5">Access Plant</th>
                    <th className="px-6 py-3.5">Access Page</th>
                    <th className="px-6 py-3.5">Status</th>
                    <th className="px-6 py-3.5">Created Date</th>
                    <th className="px-6 py-3.5">Updated Date</th>
                    <th className="px-6 py-3.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {users.map((u) => (
                    <tr key={u._id} className="hover:bg-slate-50/70 transition">
                      <td className="px-6 py-4">
                        <span className="font-bold text-slate-900 text-sm">{u.fullName}</span>
                      </td>
                      <td className="px-6 py-4 text-slate-700 font-mono">@{u.username}</td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                            u.role === 'Admin'
                              ? 'bg-purple-100 text-purple-800'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          <Shield className="w-3 h-3" />
                          <span>{u.role || 'User'}</span>
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-1 max-w-[220px]">
                          {u.role === 'Admin' ? (
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-100 text-emerald-800">
                              All Plants
                            </span>
                          ) : !u.accessPlants || u.accessPlants.length === 0 ? (
                            <span className="text-slate-400">None assigned</span>
                          ) : (
                            u.accessPlants.map((p: any) => (
                              <span
                                key={p._id || p}
                                className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-slate-100 text-slate-700"
                              >
                                {p.plantName || 'Plant'}
                              </span>
                            ))
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-1 max-w-[240px]">
                          {u.role === 'Admin' ? (
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-100 text-emerald-800">
                              All Pages (Full Access)
                            </span>
                          ) : (
                            u.accessPages.map((page) => (
                              <span
                                key={page}
                                className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-slate-100 text-slate-700"
                              >
                                {page}
                              </span>
                            ))
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                            u.status === 'Active'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-rose-100 text-rose-800'
                          }`}
                        >
                          {u.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-slate-500 text-[11px]">
                        {formatDateTime(u.createdAt)}
                      </td>
                      <td className="px-6 py-4 text-slate-500 text-[11px]">
                        {formatDateTime(u.updatedAt)}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => openEditModal(u)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 hover:border-emerald-500 hover:bg-emerald-50 text-slate-700 hover:text-emerald-700 text-xs font-bold transition cursor-pointer"
                            title="Edit user"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                            <span>Edit</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => confirmToggleStatus(u)}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs font-bold transition cursor-pointer ${
                              u.status === 'Active'
                                ? 'border-rose-200 hover:bg-rose-50 text-rose-600'
                                : 'border-emerald-200 hover:bg-emerald-50 text-emerald-600'
                            }`}
                            title={u.status === 'Active' ? 'Deactivate user' : 'Activate user'}
                          >
                            <Power className="w-3.5 h-3.5" />
                            <span>{u.status === 'Active' ? 'Deactivate' : 'Activate'}</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Modal: Add User */}
        <Modal
          isOpen={isCreateModalOpen}
          onClose={() => !isSubmitting && setIsCreateModalOpen(false)}
          title="Add New User Account"
          subtitle="Assign roles, individual page permissions, and plant-level access"
          maxWidth="xl"
        >
          {formError && (
            <div className="flex items-center gap-2 p-3 mb-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-medium">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          <form onSubmit={handleCreateSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Full Name *
                </label>
                <input
                  type="text"
                  value={formData.fullName}
                  onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                  placeholder="e.g. Ramesh Chandra"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-medium focus:border-emerald-500 focus:outline-hidden"
                  disabled={isSubmitting}
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Username *
                </label>
                <input
                  type="text"
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  placeholder="e.g. ramesh"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-mono focus:border-emerald-500 focus:outline-hidden"
                  disabled={isSubmitting}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Role *
                </label>
                <select
                  value={formData.role}
                  onChange={(e) => handleRoleChange(e.target.value as any)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-medium focus:border-emerald-500 focus:outline-hidden bg-white"
                  disabled={isSubmitting}
                >
                  <option value="User">User / Plant Operator</option>
                  <option value="Admin">Administrator (Full System Access)</option>
                </select>
                {formData.role === 'Admin' && (
                  <p className="mt-1.5 text-[11px] font-semibold text-emerald-700 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>Admin automatically accesses all current & future pages</span>
                  </p>
                )}
              </div>

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
            </div>

            {/* Password & Confirm Password */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Password *
                </label>
                <div className="relative rounded-xl border border-slate-300 focus-within:border-emerald-500">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    placeholder="Enter password"
                    className="w-full px-3.5 pr-10 py-2.5 text-sm focus:outline-hidden"
                    disabled={isSubmitting}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 transition cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Confirm Password *
                </label>
                <div className="relative rounded-xl border border-slate-300 focus-within:border-emerald-500">
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={formData.confirmPassword}
                    onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                    placeholder="Confirm password"
                    className="w-full px-3.5 pr-10 py-2.5 text-sm focus:outline-hidden"
                    disabled={isSubmitting}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 transition cursor-pointer"
                  >
                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>

            {/* Access Plants Selection */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Access Plant
                </label>
                <button
                  type="button"
                  onClick={selectAllPlants}
                  className="text-[11px] font-bold text-emerald-600 hover:underline cursor-pointer"
                >
                  Select All Active Plants
                </button>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 grid grid-cols-1 sm:grid-cols-2 gap-2">
                {activePlants.map((plant) => {
                  const isChecked = formData.accessPlants.includes(plant._id);
                  return (
                    <label
                      key={plant._id}
                      className="flex items-center gap-2 text-xs font-semibold text-slate-800 cursor-pointer select-none"
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => togglePlant(plant._id)}
                        className="rounded-sm border-slate-300 text-emerald-600 focus:ring-emerald-500 w-4 h-4"
                      />
                      <span>{plant.plantName}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Access Pages Selection */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Access Page
                </label>
                {formData.role !== 'Admin' && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={selectAllPages}
                      className="text-[11px] font-bold text-emerald-600 hover:underline cursor-pointer"
                    >
                      Select All
                    </button>
                    <span className="text-slate-300 text-xs">|</span>
                    <button
                      type="button"
                      onClick={deselectAllPages}
                      className="text-[11px] font-bold text-slate-500 hover:underline cursor-pointer"
                    >
                      Reset
                    </button>
                  </div>
                )}
              </div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 grid grid-cols-2 sm:grid-cols-3 gap-2">
                {availablePages.map((page) => {
                  const isChecked = formData.role === 'Admin' || formData.accessPages.includes(page);
                  return (
                    <label
                      key={page}
                      className="flex items-center gap-2 text-xs font-semibold text-slate-800 cursor-pointer select-none"
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        disabled={formData.role === 'Admin'}
                        onChange={() => togglePage(page)}
                        className="rounded-sm border-slate-300 text-emerald-600 focus:ring-emerald-500 w-4 h-4 disabled:opacity-80"
                      />
                      <span className={formData.role === 'Admin' ? 'text-slate-900 font-bold' : ''}>
                        {page}
                      </span>
                    </label>
                  );
                })}
              </div>
              {formData.role === 'Admin' && (
                <p className="mt-1.5 text-[11px] text-emerald-700 font-medium">
                  Administrator role is automatically granted full access to all system pages, including any new pages added in the future.
                </p>
              )}
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
                {isSubmitting ? 'Saving...' : 'Save User'}
              </button>
            </div>
          </form>
        </Modal>

        {/* Modal: Edit User */}
        <Modal
          isOpen={isEditModalOpen}
          onClose={() => !isSubmitting && setIsEditModalOpen(false)}
          title={`Edit User – ${selectedUser?.fullName || ''}`}
          subtitle="Modify user access permissions, plants, roles, or reset password"
          maxWidth="xl"
        >
          {formError && (
            <div className="flex items-center gap-2 p-3 mb-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-medium">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          <form onSubmit={handleEditSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Full Name *
                </label>
                <input
                  type="text"
                  value={formData.fullName}
                  onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-medium focus:border-emerald-500 focus:outline-hidden"
                  disabled={isSubmitting}
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Username *
                </label>
                <input
                  type="text"
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-mono focus:border-emerald-500 focus:outline-hidden"
                  disabled={isSubmitting}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Role *
                </label>
                <select
                  value={formData.role}
                  onChange={(e) => handleRoleChange(e.target.value as any)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-medium focus:border-emerald-500 focus:outline-hidden bg-white"
                  disabled={isSubmitting}
                >
                  <option value="User">User / Plant Operator</option>
                  <option value="Admin">Administrator (Full System Access)</option>
                </select>
                {formData.role === 'Admin' && (
                  <p className="mt-1.5 text-[11px] font-semibold text-emerald-700 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>Admin automatically accesses all current & future pages</span>
                  </p>
                )}
              </div>

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
            </div>

            {/* Optional Password Reset */}
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
              <p className="text-xs font-bold text-slate-800 mb-2">
                Reset Password (Optional – leave blank to keep existing password)
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="relative rounded-xl border border-slate-300 bg-white focus-within:border-emerald-500">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    placeholder="New password"
                    className="w-full px-3.5 pr-10 py-2 text-xs focus:outline-hidden"
                    disabled={isSubmitting}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 transition cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>

                <div className="relative rounded-xl border border-slate-300 bg-white focus-within:border-emerald-500">
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={formData.confirmPassword}
                    onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                    placeholder="Confirm new password"
                    className="w-full px-3.5 pr-10 py-2 text-xs focus:outline-hidden"
                    disabled={isSubmitting}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 transition cursor-pointer"
                  >
                    {showConfirmPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            </div>

            {/* Access Plants Selection */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Access Plant
                </label>
                <button
                  type="button"
                  onClick={selectAllPlants}
                  className="text-[11px] font-bold text-emerald-600 hover:underline cursor-pointer"
                >
                  Select All
                </button>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 grid grid-cols-1 sm:grid-cols-2 gap-2">
                {activePlants.map((plant) => {
                  const isChecked = formData.accessPlants.includes(plant._id);
                  return (
                    <label
                      key={plant._id}
                      className="flex items-center gap-2 text-xs font-semibold text-slate-800 cursor-pointer select-none"
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => togglePlant(plant._id)}
                        className="rounded-sm border-slate-300 text-emerald-600 focus:ring-emerald-500 w-4 h-4"
                      />
                      <span>{plant.plantName}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Access Pages Selection */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Access Page
                </label>
                {formData.role !== 'Admin' && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={selectAllPages}
                      className="text-[11px] font-bold text-emerald-600 hover:underline cursor-pointer"
                    >
                      Select All
                    </button>
                    <span className="text-slate-300 text-xs">|</span>
                    <button
                      type="button"
                      onClick={deselectAllPages}
                      className="text-[11px] font-bold text-slate-500 hover:underline cursor-pointer"
                    >
                      Reset
                    </button>
                  </div>
                )}
              </div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 grid grid-cols-2 sm:grid-cols-3 gap-2">
                {availablePages.map((page) => {
                  const isChecked = formData.role === 'Admin' || formData.accessPages.includes(page);
                  return (
                    <label
                      key={page}
                      className="flex items-center gap-2 text-xs font-semibold text-slate-800 cursor-pointer select-none"
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        disabled={formData.role === 'Admin'}
                        onChange={() => togglePage(page)}
                        className="rounded-sm border-slate-300 text-emerald-600 focus:ring-emerald-500 w-4 h-4 disabled:opacity-80"
                      />
                      <span className={formData.role === 'Admin' ? 'text-slate-900 font-bold' : ''}>
                        {page}
                      </span>
                    </label>
                  );
                })}
              </div>
              {formData.role === 'Admin' && (
                <p className="mt-1.5 text-[11px] text-emerald-700 font-medium">
                  Administrator role is automatically granted full access to all system pages, including any new pages added in the future.
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

        {/* Confirmation Modal for Status Toggle */}
        <ConfirmationModal
          isOpen={statusModalOpen}
          onClose={() => setStatusModalOpen(false)}
          onConfirm={handleStatusToggle}
          title={`${userToToggle?.status === 'Active' ? 'Deactivate' : 'Activate'} User`}
          message={`Are you sure you want to ${
            userToToggle?.status === 'Active' ? 'deactivate' : 'activate'
          } account "${userToToggle?.fullName}" (@${userToToggle?.username})? ${
            userToToggle?.status === 'Active'
              ? 'This user will immediately be blocked from logging into Sikka Fleet.'
              : 'This user will regain access to authorized fleet pages.'
          }`}
          confirmText={userToToggle?.status === 'Active' ? 'Deactivate Account' : 'Activate Account'}
          confirmVariant={userToToggle?.status === 'Active' ? 'danger' : 'primary'}
        />
      </div>
    </AppLayout>
  );
}

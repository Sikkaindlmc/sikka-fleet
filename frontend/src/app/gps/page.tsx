'use client';

import React, { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Radio,
  Shield,
  Key,
  Globe,
  Eye,
  EyeOff,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  PlayCircle,
  Clock,
  Truck,
  Zap,
  Navigation,
  Compass,
  Search,
  ExternalLink,
  Plus,
  Edit3,
  Calendar,
  Building2,
  ChevronRight,
  User,
  Settings,
  Upload,
  Image as ImageIcon,
  RotateCcw,
  Sparkles,
  MapPin,
} from 'lucide-react';
import AppLayout from '../../components/AppLayout';
import Modal from '../../components/Modal';
import AlertBanner, { AlertState } from '../../components/AlertBanner';
import VehicleIcon from '../../components/VehicleIcon';
import { apiRequest } from '../../lib/api';
import { formatDateTime, formatDistance } from '../../lib/formatters';
import { useAuth } from '../../lib/authContext';
import { useVehicleIcon } from '../../lib/vehicleIconContext';
import dynamic from 'next/dynamic';

const VehicleLiveMap = dynamic(() => import('../../components/VehicleLiveMap'), {
  ssr: false,
  loading: () => (
    <div className="relative w-full h-80 sm:h-96 rounded-2xl overflow-hidden border border-slate-200 bg-slate-100 flex items-center justify-center">
      <div className="flex flex-col items-center gap-2 text-slate-400">
        <RefreshCw className="w-6 h-6 animate-spin text-emerald-600" />
        <span className="text-xs font-bold">Loading Live GPS Map...</span>
      </div>
    </div>
  ),
});

interface LiveVehicleItem {
  vehicleNumber: string;
  vehicleId: string | null;
  driverName: string;
  mobile: string;
  deviceNumber: string;
  vendorName: string;
  vehicleType: string;
  latitude: number;
  longitude: number;
  speed: number;
  ignition: boolean;
  angle: number;
  chargeOn: boolean;
  timestamp: string;
  readableTime: string;
  readableLocation?: string;
  geofence: {
    status: 'Inside' | 'Outside';
    plantName: string;
    distanceMeter: number;
    nearestPlant: string;
  };
  loadingPlan: {
    currentPlan: string;
    authorName: string;
    createdAt: string | null;
    history: Array<{
      planText: string;
      authorName: string;
      createdAt: string;
    }>;
  };
}

interface GpsSettingData {
  _id?: string;
  provider: string;
  apiUrl: string;
  status: 'Active' | 'Inactive';
  connectionStatus: 'Connected' | 'Connection Failed' | 'Pending';
  lastSync?: string | null;
  lastError?: string | null;
  pollIntervalSeconds: number;
  hasApiKey: boolean;
  maskedApiKey: string;
  hasApiSecret: boolean;
  updatedAt?: string;
}

function GpsPageContent() {
  const searchParams = useSearchParams();
  const vehicleParam = searchParams?.get('vehicle') || null;

  const { user } = useAuth();
  const { vehicleIcon, updateVehicleIcon, resetVehicleIcon } = useVehicleIcon();

  // Active Tab state: 'live' (Live Tracking) or 'settings' (Settings)
  const [activeTab, setActiveTab] = useState<'live' | 'settings'>('live');

  // Settings state
  const [setting, setSetting] = useState<GpsSettingData | null>(null);
  const [formData, setFormData] = useState({
    provider: 'WheelsEye GPS',
    apiUrl: 'https://api.wheelseye.com/currentLoc?accessToken=53afc208-0981-48c7-b134-d85d2f33dc0c',
    apiKey: '53afc208-0981-48c7-b134-d85d2f33dc0c',
    apiSecret: '',
    status: 'Active' as 'Active' | 'Inactive',
    pollIntervalSeconds: 15,
  });

  // Vehicle Icon upload state
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [isUploadingIcon, setIsUploadingIcon] = useState(false);

  // Live vehicles state
  const [liveVehicles, setLiveVehicles] = useState<LiveVehicleItem[]>([]);
  const [selectedVehicle, setSelectedVehicle] = useState<LiveVehicleItem | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'moving' | 'stopped'>('all');

  // Auto-focus searched vehicle when vehicleParam arrives
  useEffect(() => {
    if (vehicleParam) {
      setActiveTab('live');
      if (liveVehicles.length > 0) {
        const match = liveVehicles.find(
          (v) => v.vehicleNumber.trim().toUpperCase() === vehicleParam.trim().toUpperCase()
        );
        if (match) {
          setSelectedVehicle(match);
          setSearchQuery(match.vehicleNumber);
        }
      }
    }
  }, [vehicleParam, liveVehicles]);

  // Loading states
  const [isLoading, setIsLoading] = useState(true);
  const [isLiveLoading, setIsLiveLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [alert, setAlert] = useState<AlertState | null>(null);

  // Plan modal state
  const [isPlanModalOpen, setIsPlanModalOpen] = useState(false);
  const [planInput, setPlanInput] = useState('');
  const [isSavingPlan, setIsSavingPlan] = useState(false);
  const [planError, setPlanError] = useState('');

  // Handle vehicle icon file selection and upload
  const handleIconFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setAlert({
        type: 'error',
        message: 'Please upload a valid image file.',
      });
      return;
    }

    if (file.size > 1 * 1024 * 1024) {
      setAlert({
        type: 'error',
        message: 'Icon file size exceeds 1 MB limit. Please upload an image under 1 MB.',
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
      const dataUrl = event.target?.result as string;
      if (dataUrl) {
        setIsUploadingIcon(true);
        try {
          await updateVehicleIcon(dataUrl);
          setAlert({
            type: 'success',
            message: 'Vehicle Icon uploaded successfully. It is now active across all maps and GPS interface views.',
          });
        } catch (err: any) {
          setAlert({
            type: 'error',
            message: err.message || 'Failed to save vehicle icon.',
          });
        } finally {
          setIsUploadingIcon(false);
          if (fileInputRef.current) fileInputRef.current.value = '';
        }
      }
    };
    reader.readAsDataURL(file);
  };

  // Reset Vehicle Icon to default
  const handleResetIcon = async () => {
    setIsUploadingIcon(true);
    try {
      await resetVehicleIcon();
      setAlert({
        type: 'success',
        message: 'Vehicle icon reset to system default.',
      });
    } catch (err: any) {
      setAlert({
        type: 'error',
        message: err.message || 'Failed to reset vehicle icon.',
      });
    } finally {
      setIsUploadingIcon(false);
    }
  };

  // Fetch Live Vehicles from API
  const fetchLiveVehicles = useCallback(async (quiet = false) => {
    if (!quiet) setIsLiveLoading(true);
    try {
      const res = await apiRequest<{
        totalCount: number;
        provider: string;
        apiUrl: string;
        lastSync: string;
        vehicles: LiveVehicleItem[];
      }>('/gps/live-vehicles');

      const vehs = res.vehicles || [];
      setLiveVehicles(vehs);

      // Keep current selection or match vehicleParam if specified, or default to first vehicle
      setSelectedVehicle((prev) => {
        if (vehicleParam) {
          const paramMatch = vehs.find(
            (v) => v.vehicleNumber.toUpperCase() === vehicleParam.toUpperCase()
          );
          if (paramMatch) return paramMatch;
        }
        if (!prev) return vehs[0] || null;
        const found = vehs.find((v) => v.vehicleNumber === prev.vehicleNumber);
        return found || vehs[0] || null;
      });
    } catch (err: any) {
      if (err.status === 401) return;
      if (!quiet) {
        setAlert({
          type: 'error',
          message: err.message || 'Failed to fetch live vehicle telemetry from WheelsEye API.',
        });
      }
    } finally {
      if (!quiet) setIsLiveLoading(false);
    }
  }, [vehicleParam]);

  // Fetch GPS Configuration
  const fetchGpsSetting = useCallback(async () => {
    try {
      setIsLoading(true);
      const data = await apiRequest<GpsSettingData>('/gps');
      setSetting(data);
      setFormData({
        provider: data.provider || 'WheelsEye GPS',
        apiUrl:
          data.apiUrl ||
          'https://api.wheelseye.com/currentLoc?accessToken=53afc208-0981-48c7-b134-d85d2f33dc0c',
        apiKey: data.maskedApiKey || '',
        apiSecret: data.hasApiSecret ? '••••••••••••' : '',
        status: data.status || 'Active',
        pollIntervalSeconds: data.pollIntervalSeconds || 15,
      });
    } catch (err: any) {
      if (err.status === 401) return;
      setAlert({
        type: 'error',
        message: err.message || 'GPS service temporarily unavailable.',
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGpsSetting();
    fetchLiveVehicles(false);

    // Live refresh every 20 minutes (1,200,000 ms)
    const interval = setInterval(() => {
      fetchLiveVehicles(true);
    }, 20 * 60 * 1000);

    return () => clearInterval(interval);
  }, [fetchGpsSetting, fetchLiveVehicles]);

  // Handle Save Configuration
  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setAlert(null);

    if (!formData.provider.trim()) {
      setAlert({ type: 'error', message: 'GPS Provider is required.' });
      return;
    }

    setIsSaving(true);
    try {
      const res = await apiRequest<{ message: string; setting: GpsSettingData }>('/gps', {
        method: 'POST',
        body: JSON.stringify({
          provider: formData.provider.trim(),
          apiUrl: formData.apiUrl.trim(),
          apiKey: formData.apiKey,
          apiSecret: formData.apiSecret,
          status: formData.status,
          pollIntervalSeconds: Number(formData.pollIntervalSeconds) || 15,
        }),
      });

      setAlert({
        type: 'success',
        message: 'GPS configuration saved successfully.',
      });
      setSetting(res.setting);
      fetchLiveVehicles(false);
    } catch (err: any) {
      setAlert({
        type: 'error',
        message: err.message || 'Unable to connect to GPS provider.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Test Connection
  const handleTestConnection = async () => {
    setIsTesting(true);
    setAlert(null);
    try {
      const res = await apiRequest<{
        status: 'Connected' | 'Connection Failed';
        message: string;
        lastSync?: string;
      }>('/gps/test-connection', {
        method: 'POST',
      });
      if (res.status === 'Connected') {
        setAlert({
          type: 'success',
          message: res.message,
        });
        fetchLiveVehicles(false);
      } else {
        setAlert({
          type: 'error',
          message: res.message || 'Unable to connect to GPS provider.',
        });
      }
      fetchGpsSetting();
    } catch (err: any) {
      setAlert({
        type: 'error',
        message: err.message || 'Unable to connect to GPS provider.',
      });
    } finally {
      setIsTesting(false);
    }
  };

  // Open Plan Modal for selected vehicle
  const openPlanModal = () => {
    if (!selectedVehicle) return;
    setPlanError('');
    setPlanInput(selectedVehicle.loadingPlan?.currentPlan || '');
    setIsPlanModalOpen(true);
  };

  // Save Plan
  const handleSavePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVehicle || !selectedVehicle.vehicleId) {
      setPlanError('Vehicle is still synchronizing with database. Please try again in a moment.');
      return;
    }

    if (!planInput.trim()) {
      setPlanError('Please enter a loading plan description.');
      return;
    }

    setIsSavingPlan(true);
    try {
      await apiRequest(`/dashboard/vehicles/${selectedVehicle.vehicleId}/plan`, {
        method: 'POST',
        body: JSON.stringify({ planText: planInput.trim() }),
      });

      setIsPlanModalOpen(false);
      setAlert({
        type: 'success',
        message: `Plan saved for vehicle ${selectedVehicle.vehicleNumber}.`,
      });
      fetchLiveVehicles(true);
    } catch (err: any) {
      setPlanError(err.message || 'Failed to save loading plan.');
    } finally {
      setIsSavingPlan(false);
    }
  };

  // Filtered vehicles for left side
  const filteredVehicles = liveVehicles.filter((v) => {
    const matchesSearch = v.vehicleNumber.toLowerCase().includes(searchQuery.toLowerCase().trim());
    if (!matchesSearch) return false;

    if (statusFilter === 'moving') return v.speed > 0;
    if (statusFilter === 'stopped') return v.speed === 0;
    return true;
  });

  return (
    <AppLayout pageTitle="GPS Telematics Integration" requiredPage="GPS">
      <div className="space-y-6">
        {/* Navigation Tabs: Live GPS Telematics vs Settings */}
        <div className="flex items-center gap-2 border-b border-slate-200">
          <button
            type="button"
            onClick={() => setActiveTab('live')}
            className={`flex items-center gap-2 px-4 py-3 text-xs font-bold border-b-2 transition cursor-pointer ${
              activeTab === 'live'
                ? 'border-emerald-500 text-slate-900 bg-emerald-50/50'
                : 'border-transparent text-slate-500 hover:text-slate-900 hover:border-slate-300'
            }`}
          >
            <Radio className="w-4 h-4 text-emerald-600" />
            <span>Live GPS Telematics</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">
              {liveVehicles.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('settings')}
            className={`flex items-center gap-2 px-4 py-3 text-xs font-bold border-b-2 transition cursor-pointer ${
              activeTab === 'settings'
                ? 'border-emerald-500 text-slate-900 bg-emerald-50/50'
                : 'border-transparent text-slate-500 hover:text-slate-900 hover:border-slate-300'
            }`}
          >
            <Settings className="w-4 h-4 text-slate-600" />
            <span>Settings</span>
            {vehicleIcon && (
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            )}
          </button>
        </div>

        {/* ========================================================================= */}
        {/* ACTIVE TAB: SETTINGS (Vehicle Icon Setting & API Config)                  */}
        {/* ========================================================================= */}
        {activeTab === 'settings' ? (
          <div className="space-y-6 animate-in fade-in duration-150">
            {/* 1. VEHICLE ICON SETTING SECTION */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6">
              <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-100 mb-6">
                <div>
                  <div className="flex items-center gap-2 text-xs font-bold text-emerald-700 uppercase tracking-wider mb-1">
                    <Sparkles className="w-4 h-4" />
                    <span>Visual Customization</span>
                  </div>
                  <h2 className="text-xl font-black text-slate-900 tracking-tight">
                    Vehicle Icon Setting
                  </h2>
                  <p className="text-xs text-slate-500 mt-1 max-w-2xl">
                    Upload an active vehicle icon for the fleet. Once uploaded, the selected Vehicle Icon is displayed throughout the complete application wherever vehicles are represented on the map, GPS interface, dashboard, and vehicle register.
                  </p>
                </div>

                {vehicleIcon && (
                  <button
                    type="button"
                    onClick={handleResetIcon}
                    disabled={isUploadingIcon}
                    className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-rose-50 text-slate-600 hover:text-rose-700 border border-slate-200 hover:border-rose-200 rounded-xl text-xs font-bold transition cursor-pointer disabled:opacity-50"
                    title="Revert to system default truck icon"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Reset to Default</span>
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                {/* Upload Action Card */}
                <div className="lg:col-span-7 bg-slate-50/60 rounded-2xl border-2 border-dashed border-slate-300 p-6 flex flex-col items-center justify-center text-center hover:border-emerald-500 transition">
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleIconFileSelect}
                    accept="image/*"
                    className="hidden"
                  />

                  {vehicleIcon ? (
                    <div className="flex flex-col items-center w-full">
                      {/* Uploaded Image Display */}
                      <div className="relative group mb-4">
                        <div className="w-24 h-24 rounded-2xl bg-white border-2 border-emerald-500/80 shadow-md p-3 flex items-center justify-center relative overflow-hidden">
                          <img
                            src={vehicleIcon}
                            alt="Active Vehicle Icon"
                            className="w-full h-full object-contain"
                          />
                        </div>
                        <span className="absolute -top-2 -right-2 px-2 py-0.5 bg-emerald-600 text-white text-[10px] font-bold rounded-full shadow-sm flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>Active</span>
                        </span>
                      </div>

                      <h3 className="text-sm font-bold text-slate-900 mb-1">
                        Custom Vehicle Icon Active
                      </h3>
                      <p className="text-xs text-slate-500 max-w-md mb-4 leading-relaxed">
                        This uploaded image is currently active and rendered across the dashboard, GPS tracking, and fleet map views.
                      </p>

                      {/* Action buttons: Change Image & Reset */}
                      <div className="flex flex-wrap items-center justify-center gap-3">
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={isUploadingIcon}
                          className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 text-slate-950 text-xs font-bold rounded-xl shadow-md shadow-emerald-500/20 transition cursor-pointer disabled:opacity-50"
                        >
                          <Edit3 className="w-4 h-4" />
                          <span>{isUploadingIcon ? 'Updating...' : 'Change Image'}</span>
                        </button>

                        <button
                          type="button"
                          onClick={handleResetIcon}
                          disabled={isUploadingIcon}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2.5 bg-white hover:bg-rose-50 text-slate-600 hover:text-rose-700 border border-slate-200 hover:border-rose-200 text-xs font-bold rounded-xl transition cursor-pointer disabled:opacity-50"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Reset to Default</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center">
                      <div className="w-16 h-16 rounded-2xl bg-white border border-slate-200 shadow-md flex items-center justify-center text-emerald-600 mb-4 p-3">
                        <VehicleIcon className="w-full h-full text-emerald-600" />
                      </div>

                      <h3 className="text-sm font-bold text-slate-900 mb-1">
                        Upload New Vehicle Icon
                      </h3>
                      <p className="text-xs text-slate-500 max-w-md mb-4 leading-relaxed">
                        Supports <strong>all image formats</strong>. Upload any vehicle icon image with file size <strong>under 1 MB</strong>.
                      </p>

                      <div className="flex flex-wrap items-center justify-center gap-3">
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={isUploadingIcon}
                          className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 text-slate-950 text-xs font-bold rounded-xl shadow-md shadow-emerald-500/20 transition cursor-pointer disabled:opacity-50"
                        >
                          <Upload className="w-4 h-4" />
                          <span>{isUploadingIcon ? 'Uploading...' : 'Choose Icon File'}</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Live Preview Card */}
                <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200 p-5 shadow-xs flex flex-col justify-between">
                  <div className="pb-3 border-b border-slate-100 mb-4">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Live Preview
                      </span>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          vehicleIcon
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {vehicleIcon ? 'Custom Icon Active' : 'Default SVG Active'}
                      </span>
                    </div>
                    <h4 className="text-sm font-bold text-slate-900 mt-1">
                      Representation Across UI
                    </h4>
                  </div>

                  {/* 3 Presentation Context Previews */}
                  <div className="grid grid-cols-3 gap-3 mb-4 text-center">
                    {/* Light Context */}
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex flex-col items-center">
                      <span className="text-[10px] font-bold text-slate-400 mb-2 block">
                        Light Mode
                      </span>
                      <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 shadow-xs flex items-center justify-center p-1.5">
                        <VehicleIcon className="w-full h-full text-slate-900" />
                      </div>
                    </div>

                    {/* Dark Context */}
                    <div className="p-3 bg-slate-900 rounded-xl border border-slate-800 flex flex-col items-center">
                      <span className="text-[10px] font-bold text-slate-400 mb-2 block">
                        Dark Mode
                      </span>
                      <div className="w-10 h-10 rounded-xl bg-slate-800 border border-slate-700 shadow-xs flex items-center justify-center p-1.5">
                        <VehicleIcon className="w-full h-full text-emerald-400" />
                      </div>
                    </div>

                    {/* GPS Map Pin Context */}
                    <div className="p-3 bg-emerald-50/70 rounded-xl border border-emerald-200 flex flex-col items-center">
                      <span className="text-[10px] font-bold text-emerald-700 mb-2 block">
                        Map Marker
                      </span>
                      <div className="w-10 h-10 rounded-full bg-emerald-500 shadow-md shadow-emerald-500/25 flex items-center justify-center p-1.5 text-slate-950">
                        <VehicleIcon className="w-6 h-6 text-slate-950" />
                      </div>
                    </div>
                  </div>

                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-[11px] text-slate-600 leading-relaxed">
                    <span className="font-bold text-slate-800 block mb-0.5">
                      ✓ System-Wide Sync
                    </span>
                    The active vehicle icon is instantly applied to the GPS live tracking cards, interactive telemetry views, Dashboard plant widgets, and Vehicle Register.
                  </div>
                </div>
              </div>
            </div>

            {/* 2. WHEELSEYE API CONFIGURATION SECTION */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    WheelsEye GPS Telematics API Configuration
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Configure endpoint polling URL and access tokens for real-time fleet positions.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleTestConnection}
                  disabled={isTesting}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 rounded-xl text-xs font-bold transition cursor-pointer"
                >
                  <PlayCircle className={`w-3.5 h-3.5 ${isTesting ? 'animate-spin' : ''}`} />
                  <span>{isTesting ? 'Testing...' : 'Test Connection'}</span>
                </button>
              </div>

              <form onSubmit={handleSaveConfig} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                      Provider Name *
                    </label>
                    <input
                      type="text"
                      value={formData.provider}
                      onChange={(e) => setFormData({ ...formData, provider: e.target.value })}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs font-medium focus:border-emerald-500 focus:outline-hidden"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                      API Endpoint URL *
                    </label>
                    <input
                      type="url"
                      value={formData.apiUrl}
                      onChange={(e) => setFormData({ ...formData, apiUrl: e.target.value })}
                      placeholder="https://api.wheelseye.com/currentLoc?accessToken=..."
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs font-mono focus:border-emerald-500 focus:outline-hidden"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                      API Key / Access Token
                    </label>
                    <input
                      type="text"
                      value={formData.apiKey}
                      onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                      placeholder="53afc208-0981-48c7-b134-d85d2f33dc0c"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs font-mono focus:border-emerald-500 focus:outline-hidden"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="px-5 py-2.5 text-xs font-bold text-slate-950 bg-emerald-500 hover:bg-emerald-600 rounded-xl shadow-xs transition cursor-pointer disabled:opacity-50"
                  >
                    {isSaving ? 'Saving...' : 'Save API Settings'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        ) : (
          /* ========================================================================= */
          /* ACTIVE TAB: LIVE GPS TELEMATICS                                           */
          /* ========================================================================= */
          <div className="space-y-6">
            {/* Top Control Bar */}
            <div className="flex items-center justify-between gap-3 pb-2 border-b border-slate-200">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                <Radio className="w-3.5 h-3.5 text-emerald-600 animate-pulse" />
                <span>Live WheelsEye GPS • Auto-sync every 20 minutes</span>
              </div>

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => fetchLiveVehicles(false)}
                  disabled={isLiveLoading}
                  className="inline-flex items-center gap-2 px-3.5 py-2 bg-white hover:bg-slate-50 text-slate-800 border border-slate-300 text-xs font-bold rounded-xl shadow-xs transition cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLiveLoading ? 'animate-spin' : ''}`} />
                  <span>{isLiveLoading ? 'Refreshing...' : 'Refresh Telemetry'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('settings')}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl shadow-xs transition cursor-pointer"
                >
                  <Settings className="w-3.5 h-3.5" />
                  <span>Settings &amp; Vehicle Icon</span>
                </button>
              </div>
            </div>

            {/* Top Status Strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
                <span className="text-[10px] font-bold uppercase text-slate-400 block">
                  API Provider
                </span>
                <span className="text-sm font-extrabold text-slate-900 mt-0.5 block truncate">
                  {setting?.provider || 'WheelsEye GPS'}
                </span>
              </div>

              <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
                <span className="text-[10px] font-bold uppercase text-slate-400 block">
                  Active Streams
                </span>
                <span className="text-sm font-extrabold text-emerald-700 mt-0.5 block">
                  {liveVehicles.length} Live Vehicles
                </span>
              </div>

              <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
                <span className="text-[10px] font-bold uppercase text-slate-400 block">
                  Connection Status
                </span>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-xs font-bold text-slate-800">Connected</span>
                </div>
              </div>

              <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
                <span className="text-[10px] font-bold uppercase text-slate-400 block">
                  Last Sync
                </span>
                <span className="text-xs font-bold text-slate-700 mt-0.5 block truncate">
                  {formatDateTime(setting?.lastSync || new Date())}
                </span>
              </div>
            </div>

            {/* MAIN SPLIT VIEW: Left Side Vehicle List & Right Side Current Loading / Telemetry */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* ========================================================================= */}
              {/* LEFT SIDE: Vehicle List from API */}
              {/* ========================================================================= */}
              <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200 shadow-xs flex flex-col overflow-hidden max-h-[780px]">
                {/* Left Header */}
                <div className="p-4 border-b border-slate-100 bg-slate-50/70">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <VehicleIcon className="w-4 h-4 text-emerald-600" />
                      <h2 className="text-sm font-bold text-slate-900 tracking-tight">
                        API Vehicles ({liveVehicles.length})
                      </h2>
                    </div>
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                      Select to View
                    </span>
                  </div>

              {/* Search input */}
              <div className="relative rounded-xl border border-slate-300 bg-white focus-within:border-emerald-500 flex items-center mb-2.5">
                <Search className="w-4 h-4 text-slate-400 ml-3 shrink-0" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search vehicle number (e.g. UP14HT)..."
                  className="w-full px-3 py-2 text-xs font-bold uppercase tracking-wider focus:outline-hidden placeholder:font-normal placeholder:capitalize"
                />
              </div>

              {/* Filter Tabs */}
              <div className="flex items-center gap-1.5 text-[11px] font-bold">
                <button
                  type="button"
                  onClick={() => setStatusFilter('all')}
                  className={`px-2.5 py-1 rounded-lg transition cursor-pointer ${
                    statusFilter === 'all'
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-200/70 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  All ({liveVehicles.length})
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('moving')}
                  className={`px-2.5 py-1 rounded-lg transition cursor-pointer ${
                    statusFilter === 'moving'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-200/70 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  Moving ({liveVehicles.filter((v) => v.speed > 0).length})
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('stopped')}
                  className={`px-2.5 py-1 rounded-lg transition cursor-pointer ${
                    statusFilter === 'stopped'
                      ? 'bg-amber-600 text-white'
                      : 'bg-slate-200/70 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  Stopped ({liveVehicles.filter((v) => v.speed === 0).length})
                </button>
              </div>
            </div>

            {/* Scrollable Vehicle List */}
            <div className="overflow-y-auto divide-y divide-slate-100 flex-1 p-2">
              {filteredVehicles.length === 0 ? (
                <div className="p-8 text-center text-slate-400">
                  <Truck className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                  <p className="text-xs font-semibold">No vehicles match filter</p>
                </div>
              ) : (
                filteredVehicles.map((v) => {
                  const isSelected = selectedVehicle?.vehicleNumber === v.vehicleNumber;
                  const isMoving = v.speed > 0;
                  const hasPlan = Boolean(v.loadingPlan?.currentPlan);

                  return (
                    <button
                      key={v.vehicleNumber}
                      type="button"
                      onClick={() => setSelectedVehicle(v)}
                      className={`w-full text-left p-3 rounded-xl transition-all cursor-pointer mb-1 flex items-start justify-between gap-3 ${
                        isSelected
                          ? 'bg-emerald-500/10 border-2 border-emerald-500 shadow-xs'
                          : 'hover:bg-slate-50 border border-transparent'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-extrabold text-sm text-slate-900 tracking-wide">
                            {v.vehicleNumber}
                          </span>
                          {/* Ignition Pill */}
                          <span
                            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold ${
                              v.ignition
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-slate-100 text-slate-500'
                            }`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                v.ignition ? 'bg-emerald-500' : 'bg-slate-400'
                              }`}
                            />
                            {v.ignition ? 'IGN ON' : 'IGN OFF'}
                          </span>
                        </div>

                        {/* Vendor & Status */}
                        <p className="text-[11px] text-slate-500 mt-0.5 truncate font-medium">
                          {v.vendorName} • {v.vehicleType}
                        </p>

                        {/* Geofence & Plan status */}
                        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                          <span
                            className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                              v.geofence.status === 'Inside'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {v.geofence.status === 'Inside'
                              ? `Inside ${v.geofence.plantName}`
                              : 'Outside Plants'}
                          </span>

                          {hasPlan ? (
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-indigo-100 text-indigo-800">
                              Plan Set
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.5 rounded-md text-[10px] font-semibold text-slate-400 bg-slate-100">
                              No Plan
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Speed badge */}
                      <div className="text-right shrink-0 flex flex-col items-end">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                            isMoving
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {isMoving ? `${Math.round(v.speed)} km/h` : 'Stopped'}
                        </span>
                        <span className="text-[10px] text-slate-400 mt-1 font-mono">
                          {v.readableTime?.split(',')[1] || ''}
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* ========================================================================= */}
          {/* RIGHT SIDE: Current Loading & Live Telemetry Details */}
          {/* ========================================================================= */}
          <div className="lg:col-span-7 space-y-4">
            {!selectedVehicle ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-400 shadow-xs">
                <Truck className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                <p className="text-sm font-bold text-slate-700">No Vehicle Selected</p>
                <p className="text-xs text-slate-500 mt-1">
                  Click any vehicle from the list on the left to inspect its live loading and telemetry.
                </p>
              </div>
            ) : (
              <>
                {/* Vehicle Header Card */}
                <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div className="flex items-center gap-3.5">
                    <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center text-slate-950 font-black text-lg shadow-md shadow-emerald-500/20 shrink-0">
                      <Truck className="w-6 h-6" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-2xl font-black text-slate-900 tracking-tight">
                          {selectedVehicle.vehicleNumber}
                        </h2>
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                            selectedVehicle.speed > 0
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {selectedVehicle.speed > 0
                            ? `Moving (${Math.round(selectedVehicle.speed)} km/h)`
                            : 'Stopped / Idle'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Vendor: <strong className="text-slate-800">{selectedVehicle.vendorName}</strong> • Type: <strong className="text-slate-800">{selectedVehicle.vehicleType}</strong>
                      </p>
                    </div>
                  </div>

                  {/* Direct Map Link */}
                  <div className="flex items-center gap-2">
                    <a
                      href={`https://maps.google.com/?q=${selectedVehicle.latitude},${selectedVehicle.longitude}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs transition cursor-pointer"
                    >
                      <ExternalLink className="w-3.5 h-3.5 text-slate-600" />
                      <span>View on Google Maps</span>
                    </a>
                  </div>
                </div>

                {/* ========================================================================= */}
                {/* LIVE MAP & READABLE LOCATION CARD (Requirements 24.7, 24.8, 24.9)         */}
                {/* ========================================================================= */}
                <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-xs space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-slate-100">
                    <div>
                      <div className="flex items-center gap-2">
                        <MapPin className="w-4 h-4 text-emerald-600" />
                        <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
                          Live Vehicle GPS Map &amp; Tracking
                        </h3>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Real-time tracking visualizer centered on {selectedVehicle.vehicleNumber}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        <span>Live Coordinates</span>
                      </span>
                    </div>
                  </div>

                  {/* READABLE LOCATION HIGHLIGHT (Requirement 24.8 & 24.9) */}
                  <div className="p-4 rounded-xl bg-gradient-to-r from-emerald-50/90 via-teal-50/70 to-slate-50 border border-emerald-200/80">
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
                      <div className="md:col-span-8 flex items-start gap-3">
                        <div className="w-9 h-9 rounded-xl bg-emerald-500 text-slate-950 flex items-center justify-center shrink-0 shadow-xs">
                          <MapPin className="w-5 h-5" />
                        </div>
                        <div>
                          <span className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-800 block">
                            Vehicle Location / Readable Address
                          </span>
                          <p className="text-sm font-extrabold text-slate-950 mt-0.5 leading-snug">
                            {selectedVehicle.readableLocation || 'Near Meerut Road Corridor, Ghaziabad, Uttar Pradesh'}
                          </p>
                        </div>
                      </div>

                      <div className="md:col-span-4 bg-white/80 backdrop-blur-xs p-2.5 rounded-lg border border-emerald-200/60 md:text-right">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                          GPS Updated Date Time
                        </span>
                        <span className="text-xs font-bold text-slate-900 font-mono block mt-0.5">
                          {selectedVehicle.readableTime || formatDateTime(selectedVehicle.timestamp)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* INTERACTIVE MAP CONTAINER WITH CUSTOM VEHICLE ICON PIN (Google Maps) */}
                  <VehicleLiveMap
                    vehicleNumber={selectedVehicle.vehicleNumber}
                    latitude={selectedVehicle.latitude}
                    longitude={selectedVehicle.longitude}
                    speed={selectedVehicle.speed}
                    readableLocation={selectedVehicle.readableLocation}
                    readableTime={selectedVehicle.readableTime || formatDateTime(selectedVehicle.timestamp)}
                    plantName={selectedVehicle.geofence?.plantName}
                  />
                </div>

                {/* CURRENT LOADING / DISPATCH PLAN CARD */}
                <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-xs relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-2 h-full bg-emerald-500 opacity-80" />

                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3.5 border-b border-slate-100 mb-4">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                        <span>Current Loading &amp; Dispatch Plan</span>
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Commercial dispatch instructions, loading plant destination, and materials
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={openPlanModal}
                      className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer shadow-xs ${
                        selectedVehicle.loadingPlan?.currentPlan
                          ? 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200'
                          : 'bg-emerald-500 hover:bg-emerald-600 text-slate-950 shadow-emerald-500/20'
                      }`}
                    >
                      {selectedVehicle.loadingPlan?.currentPlan ? (
                        <>
                          <Edit3 className="w-3.5 h-3.5" />
                          <span>Edit Loading Plan</span>
                        </>
                      ) : (
                        <>
                          <Plus className="w-3.5 h-3.5" />
                          <span>+ Add Loading Plan</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Active Plan Display */}
                  {selectedVehicle.loadingPlan?.currentPlan ? (
                    <div className="space-y-3">
                      <div className="p-4 rounded-xl bg-emerald-50/90 border border-emerald-200/90 text-slate-900">
                        <div className="flex items-center justify-between text-[11px] font-bold text-emerald-800 uppercase tracking-wider mb-1">
                          <span className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                            <span>
                              {selectedVehicle.loadingPlan.history.length > 1 ? 'New Plan' : 'Plan'} by{' '}
                              {selectedVehicle.loadingPlan.authorName || 'Dispatcher'}
                            </span>
                          </span>
                          <span className="font-mono">
                            {formatDateTime(selectedVehicle.loadingPlan.createdAt)}
                          </span>
                        </div>
                        <p className="text-sm font-bold text-slate-900 leading-relaxed">
                          {selectedVehicle.loadingPlan.currentPlan}
                        </p>
                      </div>

                      {/* Older Revision History */}
                      {selectedVehicle.loadingPlan.history.length > 1 && (
                        <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-2">
                            Previous Plan Audit Trail
                          </span>
                          <div className="space-y-2 max-h-36 overflow-y-auto pr-1">
                            {selectedVehicle.loadingPlan.history
                              .slice(0, -1)
                              .reverse()
                              .map((oldPlan, idx) => (
                                <div
                                  key={idx}
                                  className="text-xs bg-white p-2.5 rounded-lg border border-slate-200 text-slate-700"
                                >
                                  <div className="flex items-center justify-between text-[10px] text-slate-400 font-semibold mb-0.5">
                                    <span>Old Plan by {oldPlan.authorName}</span>
                                    <span>{formatDateTime(oldPlan.createdAt)}</span>
                                  </div>
                                  <p className="font-medium italic text-slate-800">
                                    {oldPlan.planText}
                                  </p>
                                </div>
                              ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="p-6 rounded-xl border border-dashed border-slate-300 text-center bg-slate-50/50">
                      <p className="text-xs font-semibold text-slate-600">
                        No loading plan currently assigned for this vehicle.
                      </p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Click the button above to specify loading destination (e.g. &ldquo;This vehicle will load for Ghaziabad&rdquo;).
                      </p>
                    </div>
                  )}
                </div>

                {/* LIVE TELEMETRY SENSOR GRID */}
                <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-xs">
                  <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-4 flex items-center gap-2">
                    <Zap className="w-4 h-4 text-emerald-600" />
                    <span>Live GPS Telemetry &amp; Sensors</span>
                  </h3>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                      <span className="text-[10px] font-bold text-slate-400 uppercase block">
                        Coordinates (Lat, Lon)
                      </span>
                      <span className="font-mono font-bold text-slate-800 mt-1 block">
                        {selectedVehicle.latitude.toFixed(6)}, {selectedVehicle.longitude.toFixed(6)}
                      </span>
                    </div>

                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                      <span className="text-[10px] font-bold text-slate-400 uppercase block">
                        Current Speed
                      </span>
                      <span className="font-extrabold text-slate-900 text-sm mt-0.5 block">
                        {Math.round(selectedVehicle.speed)} km/h
                      </span>
                    </div>

                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                      <span className="text-[10px] font-bold text-slate-400 uppercase block">
                        Ignition Status
                      </span>
                      <div className="flex items-center gap-1.5 mt-1 font-bold">
                        <span
                          className={`w-2 h-2 rounded-full ${
                            selectedVehicle.ignition ? 'bg-emerald-500' : 'bg-slate-400'
                          }`}
                        />
                        <span className={selectedVehicle.ignition ? 'text-emerald-700' : 'text-slate-600'}>
                          {selectedVehicle.ignition ? 'Ignition ON' : 'Ignition OFF'}
                        </span>
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                      <span className="text-[10px] font-bold text-slate-400 uppercase block">
                        Heading / Compass
                      </span>
                      <span className="font-bold text-slate-800 mt-1 block">
                        {selectedVehicle.angle}° Angle
                      </span>
                    </div>

                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                      <span className="text-[10px] font-bold text-slate-400 uppercase block">
                        Device / IMEI
                      </span>
                      <span className="font-mono text-slate-700 mt-1 block truncate">
                        {selectedVehicle.deviceNumber}
                      </span>
                    </div>

                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                      <span className="text-[10px] font-bold text-slate-400 uppercase block">
                        Telemetry Time
                      </span>
                      <span className="font-medium text-slate-800 mt-1 block truncate">
                        {selectedVehicle.readableTime || formatDateTime(selectedVehicle.timestamp)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* GEOFENCE PROXIMITY CARD */}
                <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-xs">
                  <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-3 flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-emerald-600" />
                    <span>Geofence Proximity &amp; Plant Perimeter</span>
                  </h3>

                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                    <div>
                      <span className="text-[10px] font-bold text-slate-400 uppercase block">
                        Plant Boundary Status
                      </span>
                      <span className="text-sm font-extrabold text-slate-900 mt-0.5 block">
                        {selectedVehicle.geofence.status === 'Inside'
                          ? `Currently Inside ${selectedVehicle.geofence.plantName}`
                          : 'Outside All Configured Plants'}
                      </span>
                    </div>

                    <div className="text-left sm:text-right">
                      <span className="text-[10px] font-bold text-slate-400 uppercase block">
                        Nearest Plant Distance
                      </span>
                      <span className="text-xs font-bold text-emerald-700 mt-0.5 block">
                        {formatDistance(selectedVehicle.geofence.distanceMeter)} to{' '}
                        {selectedVehicle.geofence.nearestPlant || 'Salt Plant'}
                      </span>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    )}

        {/* Modal: Add or Edit Loading Plan */}
        <Modal
          isOpen={isPlanModalOpen}
          onClose={() => !isSavingPlan && setIsPlanModalOpen(false)}
          title={
            selectedVehicle?.loadingPlan?.currentPlan
              ? `Edit Loading Plan – ${selectedVehicle?.vehicleNumber}`
              : `Add Loading Plan – ${selectedVehicle?.vehicleNumber}`
          }
          subtitle={`Plan author: ${user?.fullName || 'User'} (@${user?.username || 'user'})`}
          maxWidth="md"
        >
          {planError && (
            <div className="flex items-center gap-2 p-3 mb-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-medium">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{planError}</span>
            </div>
          )}

          <form onSubmit={handleSavePlan} className="space-y-4">
            {/* Show previous plan history */}
            {selectedVehicle?.loadingPlan?.currentPlan && (
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 max-h-32 overflow-y-auto space-y-1 mb-2">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                  Current Plan
                </span>
                <p className="text-xs text-slate-800 font-semibold">
                  {selectedVehicle.loadingPlan.currentPlan}
                </p>
                <span className="text-[10px] text-slate-400 block">
                  By {selectedVehicle.loadingPlan.authorName} ({formatDateTime(selectedVehicle.loadingPlan.createdAt)})
                </span>
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                {selectedVehicle?.loadingPlan?.currentPlan
                  ? 'New Loading Plan (approx. 20 words) *'
                  : 'Loading Plan (approx. 20 words) *'}
              </label>
              <textarea
                rows={3}
                value={planInput}
                onChange={(e) => setPlanInput(e.target.value)}
                placeholder="e.g. This vehicle will load for Ghaziabad / Delhi"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-medium focus:border-emerald-500 focus:outline-hidden"
                disabled={isSavingPlan}
                required
              />
              <div className="flex items-center justify-between text-[11px] text-slate-400 mt-1">
                <span>Example: &ldquo;This vehicle will load for Ghaziabad&rdquo;</span>
                <span>{planInput.trim().split(/\s+/).filter(Boolean).length} words</span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsPlanModalOpen(false)}
                disabled={isSavingPlan}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-xl transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSavingPlan}
                className="px-5 py-2 text-xs font-bold text-slate-950 bg-emerald-500 hover:bg-emerald-600 rounded-xl shadow-xs transition cursor-pointer disabled:opacity-50"
              >
                {isSavingPlan ? 'Saving...' : 'Save Loading Plan'}
              </button>
            </div>
          </form>
        </Modal>
      </div>
    </AppLayout>
  );
}

export default function GpsPage() {
  return (
    <Suspense
      fallback={
        <AppLayout pageTitle="Live GPS Tracking & Telematics" requiredPage="GPS">
          <div className="py-24 flex flex-col items-center justify-center">
            <RefreshCw className="w-8 h-8 text-emerald-600 animate-spin mb-3" />
            <p className="text-sm font-bold text-slate-700">Loading GPS Telematics...</p>
            <p className="text-xs text-slate-400 mt-1">Connecting to live vehicle tracking stream</p>
          </div>
        </AppLayout>
      }
    >
      <GpsPageContent />
    </Suspense>
  );
}

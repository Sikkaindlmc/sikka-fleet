'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Building2,
  Navigation,
  Truck,
  RefreshCw,
  Compass,
  Clock,
  MapPin,
  AlertCircle,
  CheckCircle2,
  Phone,
  User,
  FileSpreadsheet,
  Plus,
  Edit3,
  Users,
  ChevronRight,
  CreditCard,
  Calendar,
  ExternalLink,
  Sparkles,
} from 'lucide-react';
import Link from 'next/link';
import AppLayout from '../../components/AppLayout';
import Modal from '../../components/Modal';
import AlertBanner, { AlertState } from '../../components/AlertBanner';
import VehicleIcon from '../../components/VehicleIcon';
import { apiRequest, API_BASE_URL } from '../../lib/api';
import { formatDateTime, formatDistance, calculateOutsideHours, getDurationColorClasses } from '../../lib/formatters';
import { useAuth } from '../../lib/authContext';
import DriverDashboardView from '../../components/DriverDashboardView';
import NearestDriverCell from '../../components/NearestDriverCell';
import NearestDriversModal, { NearestDriverItem } from '../../components/NearestDriversModal';

export interface DashboardDriverItem {
  id: string;
  driverName: string;
  mobileNumber: string;
  dlNumber?: string;
  photo?: string | null;
  vehicleNumber?: string;
  status: string;
  plantName?: string;
  plantInTime?: string | null;
  location?: string;
  distanceMeters?: number;
  readableLocation?: string;
  latitude?: number | null;
  longitude?: number | null;
  lastLocationAt?: string | null;
  isStale?: boolean;
}

export interface VehiclePlanItem {
  planText: string;
  authorName: string;
  authorUsername?: string;
  createdAt: string;
}

interface PlantWidget {
  id: string;
  name: string;
  location: string;
  radiusMeter: number;
  latitude: number;
  longitude: number;
  vehicleCount: number;
  driverCount?: number;
  isOutside: boolean;
  availableDrivers?: NearestDriverItem[];
}

interface PlantVehicle {
  id: string;
  vehicleNumber: string;
  driverName?: string | null;
  mobile?: string | null;
  driverDistance?: number | null;
  multipleDrivers?: boolean;
  noDriver?: boolean;
  nearestDrivers?: NearestDriverItem[];
  fleetType: string;
  ownerName?: string;
  entryDateTime: string;
  lastUpdateDateTime?: string | null;
  latest_gps_timestamp?: string | null;
  gps_status?: string | null;
  last_sync_source?: string | null;
  latitude: number;
  longitude: number;
  distanceMeter?: number;
  location?: string;
  readableLocation?: string;
  status: string;
  plans?: VehiclePlanItem[];
}

// Entry Time से Current Time के बीच Stay Hours (HH:MM) कैलकुलेट करने का फ़ंक्शन
const calculateStayHours = (entryDateTimeStr?: string | null): string => {
  if (!entryDateTimeStr) return '00:00';

  try {
    let entryDate: Date;

    // Handle "DD-MM-YYYY, HH:mm:ss" or ISO string
    if (typeof entryDateTimeStr === 'string' && entryDateTimeStr.includes(', ')) {
      const [datePart, timePart] = entryDateTimeStr.split(', ');
      const sep = datePart.includes('-') ? '-' : '/';
      const parts = datePart.split(sep);
      if (parts.length === 3) {
        const [day, month, year] = parts;
        entryDate = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${timePart}`);
      } else {
        entryDate = new Date(entryDateTimeStr);
      }
    } else {
      entryDate = new Date(entryDateTimeStr);
    }

    if (isNaN(entryDate.getTime())) return '00:00';

    const now = new Date(); // Current system time
    const diffInMs = now.getTime() - entryDate.getTime();
    if (diffInMs < 0) return '00:00';

    const totalMinutes = Math.floor(diffInMs / (1000 * 60));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    const formattedHours = String(hours).padStart(2, '0');
    const formattedMinutes = String(minutes).padStart(2, '0');

    return `${formattedHours}:${formattedMinutes}`;
  } catch {
    return '00:00';
  }
};

interface OutsideVehicle {
  id: string;
  vehicleNumber: string;
  lastOutPlantName?: string | null;
  plantOutDateTime?: string | null;
  lastLocationDateTime?: string | null;
  latest_gps_timestamp?: string | null;
  gps_status?: string | null;
  last_sync_source?: string | null;
  lastLocationTime?: string;
  outsideHours?: string | null;
  status: string;
  driverName?: string | null;
  mobile?: string | null;
  driverDistance?: number | null;
  multipleDrivers?: boolean;
  noDriver?: boolean;
  nearestDrivers?: NearestDriverItem[];
  locationStale?: boolean;
  fleetType?: string;
  ownerName?: string;
  latitude: number;
  longitude: number;
  readableLocation?: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const [plantWidgets, setPlantWidgets] = useState<PlantWidget[]>([]);
  const [outsideWidget, setOutsideWidget] = useState<{
    id: string;
    name: string;
    vehicleCount: number;
    driverCount?: number;
    isOutside: boolean;
  } | null>(null);
  const [totalActiveVehicles, setTotalActiveVehicles] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [nextScheduledSyncAt, setNextScheduledSyncAt] = useState<string | null>(null);
  const [syncStatusState, setSyncStatusState] = useState<'IDLE' | 'SUCCESS' | 'FAILED' | 'SYNCING'>('SUCCESS');
  const [isBackendSyncing, setIsBackendSyncing] = useState(false);
  const [nextSyncCountdown, setNextSyncCountdown] = useState<string>('30:00');
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [alert, setAlert] = useState<AlertState | null>(null);

  // Drilldown Modal State (Vehicles & Drivers)
  const [activeModal, setActiveModal] = useState<'plant' | 'outside' | 'plantDrivers' | 'outsideDrivers' | null>(null);
  const [selectedPlant, setSelectedPlant] = useState<PlantWidget | null>(null);
  const [plantVehicles, setPlantVehicles] = useState<PlantVehicle[]>([]);
  const [outsideVehicles, setOutsideVehicles] = useState<OutsideVehicle[]>([]);
  const [plantDriversList, setPlantDriversList] = useState<DashboardDriverItem[]>([]);
  const [outsideDriversList, setOutsideDriversList] = useState<DashboardDriverItem[]>([]);
  const [isModalLoading, setIsModalLoading] = useState(false);

  // Nearest Drivers Modal State (Requirement 23.3 & 23.4)
  const [isDriversModalOpen, setIsDriversModalOpen] = useState(false);
  const [selectedNearestDrivers, setSelectedNearestDrivers] = useState<NearestDriverItem[]>([]);
  const [driversModalTitle, setDriversModalTitle] = useState('Available Drivers (Within 100m)');

  // Plan Management Modal State
  const { user } = useAuth();
  const [isPlanModalOpen, setIsPlanModalOpen] = useState(false);
  const [selectedVehicleForPlan, setSelectedVehicleForPlan] = useState<PlantVehicle | null>(null);
  const [planInput, setPlanInput] = useState('');
  const [isSavingPlan, setIsSavingPlan] = useState(false);
  const [planError, setPlanError] = useState('');

  // Helper to escape HTML characters for Excel table XML/HTML
  const escapeXml = (val: string | number | null | undefined): string => {
    if (val === null || val === undefined) return '';
    return String(val)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };

  // Export Plant Vehicles list to .xls Excel file via server download
  const exportPlantVehiclesToExcel = () => {
    if (!selectedPlant) return;
    const token = typeof window !== 'undefined' ? localStorage.getItem('sikka_fleet_token') || '' : '';
    const downloadUrl = `${API_BASE_URL}/dashboard/plants/${selectedPlant.id}/export?token=${encodeURIComponent(token)}`;
    window.location.href = downloadUrl;
  };

  // Export Outside Vehicles to .xls via server download
  const exportOutsideVehiclesToExcel = () => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('sikka_fleet_token') || '' : '';
    const downloadUrl = `${API_BASE_URL}/dashboard/outside/export?token=${encodeURIComponent(token)}`;
    window.location.href = downloadUrl;
  };

  // Open Add/Edit Plan Modal for a Vehicle
  const openPlanModal = (v: PlantVehicle) => {
    setSelectedVehicleForPlan(v);
    setPlanError('');
    // If editing, start with empty input or existing plan so user can write updated plan
    const latestPlan = v.plans && v.plans.length > 0 ? v.plans[v.plans.length - 1] : null;
    setPlanInput(latestPlan ? latestPlan.planText : '');
    setIsPlanModalOpen(true);
  };

  // Handle Save Plan Submission
  const handleSavePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVehicleForPlan) return;
    setPlanError('');

    if (!planInput.trim()) {
      setPlanError('Please enter a plan description.');
      return;
    }

    setIsSavingPlan(true);
    try {
      const res = await apiRequest<{
        message: string;
        plan: VehiclePlanItem;
        plans: VehiclePlanItem[];
      }>(`/dashboard/vehicles/${selectedVehicleForPlan.id}/plan`, {
        method: 'POST',
        body: JSON.stringify({
          planText: planInput.trim(),
          plantId: selectedPlant?.id || undefined,
          plantName: selectedPlant?.name || undefined,
        }),
      });

      // Update in local plantVehicles state immediately
      setPlantVehicles((prev) =>
        prev.map((v) =>
          v.id === selectedVehicleForPlan.id ? { ...v, plans: res.plans } : v
        )
      );

      // Dispatch event to trigger immediate notification panel refresh
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('plant-plan-updated'));
      }

      setIsPlanModalOpen(false);
      setSelectedVehicleForPlan(null);
      setAlert({
        type: 'success',
        message: `Plan saved for vehicle ${selectedVehicleForPlan.vehicleNumber}.`,
      });
    } catch (err: any) {
      setPlanError(err.message || 'Failed to save dispatch plan.');
    } finally {
      setIsSavingPlan(false);
    }
  };

  // Fetch Dashboard Summary
  const fetchSummary = useCallback(async (showLoader = false) => {
    if (showLoader) setIsLoading(true);
    try {
      const data = await apiRequest<{
        plantWidgets: PlantWidget[];
        outsideWidget: { id: string; name: string; vehicleCount: number; driverCount?: number; isOutside: boolean };
        totalActiveVehicles: number;
        lastUpdated: string;
        last_evaluated_timestamp?: string;
        last_successful_sync_at?: string;
        next_sync_timestamp?: string;
        next_scheduled_sync_at?: string;
        last_sync_status?: string;
      }>('/dashboard/summary');

      setPlantWidgets(data.plantWidgets || []);
      setOutsideWidget(data.outsideWidget);
      setTotalActiveVehicles(data.totalActiveVehicles || 0);

      const evalTimestamp = data.last_successful_sync_at || data.last_evaluated_timestamp || data.lastUpdated;
      if (evalTimestamp) {
        setLastUpdated(evalTimestamp);
      }

      if (data.next_scheduled_sync_at || data.next_sync_timestamp) {
        setNextScheduledSyncAt(data.next_scheduled_sync_at || data.next_sync_timestamp || null);
      }

      if (data.last_sync_status) {
        setSyncStatusState(data.last_sync_status as any);
      }
    } catch (err: any) {
      setAlert({
        type: 'error',
        message: err.message || 'Failed to load fleet monitoring summary.',
      });
    } finally {
      if (showLoader) setIsLoading(false);
    }
  }, []);

  // Live countdown timer display bound to server-provided next scheduled sync slot (Requirement 9)
  useEffect(() => {
    let pollingWhileSyncing = false;

    const calculateCountdown = () => {
      const now = new Date();
      let targetTime: Date;

      if (nextScheduledSyncAt) {
        targetTime = new Date(nextScheduledSyncAt);
        if (isNaN(targetTime.getTime())) {
          targetTime = new Date(now.getTime() + 30 * 60 * 1000);
        }
      } else {
        const minutes = now.getMinutes();
        const target = new Date(now);
        if (minutes < 30) {
          target.setMinutes(30, 0, 0);
        } else {
          target.setHours(target.getHours() + 1, 0, 0, 0);
        }
        targetTime = target;
      }

      const diffMs = targetTime.getTime() - now.getTime();

      // When countdown reaches 00:00 (Requirement 9):
      // DO NOT assume that sync succeeded. Refresh backend sync status. Show "Syncing GPS..."
      if (diffMs <= 1000) {
        setIsBackendSyncing(true);

        if (!pollingWhileSyncing) {
          pollingWhileSyncing = true;
          setTimeout(async () => {
            try {
              const statusData = await apiRequest<{
                last_successful_sync_at?: string;
                next_scheduled_sync_at?: string;
                last_sync_status?: string;
                is_syncing?: boolean;
              }>('/gps-sync/status');

              if (statusData.last_successful_sync_at) {
                setLastUpdated(statusData.last_successful_sync_at);
              }
              if (statusData.next_scheduled_sync_at) {
                setNextScheduledSyncAt(statusData.next_scheduled_sync_at);
              }
              if (statusData.last_sync_status) {
                setSyncStatusState(statusData.last_sync_status as any);
              }
              setIsBackendSyncing(Boolean(statusData.is_syncing));
              await fetchSummary(false);
            } catch {
              setIsBackendSyncing(false);
            } finally {
              pollingWhileSyncing = false;
            }
          }, 3000);
        }

        return '00:00';
      }

      setIsBackendSyncing(false);
      const totalSeconds = Math.max(0, Math.floor(diffMs / 1000));
      const m = Math.floor(totalSeconds / 60);
      const s = totalSeconds % 60;
      return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    };

    setNextSyncCountdown(calculateCountdown());

    const timer = setInterval(() => {
      setNextSyncCountdown(calculateCountdown());
    }, 1000);

    return () => clearInterval(timer);
  }, [nextScheduledSyncAt, fetchSummary]);

  // Periodic polling interval (every 45 seconds) to ensure synchronization with server-side scheduler
  useEffect(() => {
    fetchSummary(true);

    const interval = setInterval(() => {
      fetchSummary(false);
    }, 45 * 1000);

    return () => clearInterval(interval);
  }, [fetchSummary]);

  // Handle Manual GPS Sync Trigger
  const handleTriggerSync = async () => {
    setIsSyncing(true);
    setAlert(null);
    try {
      let result: {
        message?: string;
        last_evaluated_timestamp?: string;
        last_successful_sync_at?: string;
        next_scheduled_sync_at?: string;
        lastSync?: string;
        processedCount?: number;
        vehiclesProcessed?: number;
      };

      try {
        result = await apiRequest<{
          message: string;
          last_evaluated_timestamp?: string;
          last_successful_sync_at?: string;
          next_scheduled_sync_at?: string;
          lastSync?: string;
          processedCount?: number;
          vehiclesProcessed?: number;
        }>('/gps-sync/run', {
          method: 'POST',
          body: JSON.stringify({ triggerType: 'MANUAL_DASHBOARD_BUTTON' }),
        });
      } catch {
        result = await apiRequest<{
          message: string;
          last_evaluated_timestamp?: string;
          lastSync?: string;
          processedCount?: number;
        }>('/fleet/sync-gps', {
          method: 'POST',
        });
      }

      const updatedTime = result.last_successful_sync_at || result.last_evaluated_timestamp || result.lastSync || new Date().toISOString();
      setLastUpdated(updatedTime);
      if (result.next_scheduled_sync_at) {
        setNextScheduledSyncAt(result.next_scheduled_sync_at);
      }
      setSyncStatusState('SUCCESS');

      setAlert({
        type: 'success',
        message: `${result.message || 'GPS synchronization completed.'} Evaluated positions for ${result.vehiclesProcessed || result.processedCount || 0} active vehicles.`,
      });

      await fetchSummary(false);
      if (selectedPlant) {
        const data = await apiRequest<{
          plant: { id: string; name: string; location: string; radiusMeter: number; availableDrivers?: NearestDriverItem[] };
          vehicles: PlantVehicle[];
        }>(`/dashboard/plants/${selectedPlant.id}/vehicles`);
        setPlantVehicles(data.vehicles || []);
      }
    } catch (err: any) {
      setSyncStatusState('FAILED');
      setAlert({
        type: 'error',
        message: err.message || 'Unable to connect to GPS provider.',
      });
    } finally {
      setIsSyncing(false);
    }
  };

  // Click on a Plant Widget
  const handlePlantClick = async (plant: PlantWidget) => {
    setSelectedPlant(plant);
    setActiveModal('plant');
    setIsModalLoading(true);
    try {
      const data = await apiRequest<{
        plant: { id: string; name: string; location: string; radiusMeter: number; availableDrivers?: NearestDriverItem[] };
        vehicles: PlantVehicle[];
      }>(`/dashboard/plants/${plant.id}/vehicles`);
      setSelectedPlant({
        ...plant,
        availableDrivers: data.plant.availableDrivers || [],
      });
      setPlantVehicles(data.vehicles || []);
    } catch (err: any) {
      setAlert({
        type: 'error',
        message: err.message || 'Failed to retrieve vehicles for this plant.',
      });
      setActiveModal(null);
    } finally {
      setIsModalLoading(false);
    }
  };

  // Click on the Outside Widget (Vehicles)
  const handleOutsideClick = async () => {
    setActiveModal('outside');
    setIsModalLoading(true);
    try {
      const data = await apiRequest<{
        title: string;
        vehicles: OutsideVehicle[];
      }>('/dashboard/outside/vehicles');
      setOutsideVehicles(data.vehicles || []);
    } catch (err: any) {
      setAlert({
        type: 'error',
        message: err.message || 'Failed to retrieve outside vehicles.',
      });
      setActiveModal(null);
    } finally {
      setIsModalLoading(false);
    }
  };

  // Click on Drivers for a Plant
  const handlePlantDriversClick = async (plant: PlantWidget) => {
    setSelectedPlant(plant);
    setActiveModal('plantDrivers');
    setIsModalLoading(true);
    try {
      const data = await apiRequest<{
        title: string;
        plant: { id: string; name: string; location: string; radiusMeter: number };
        drivers: DashboardDriverItem[];
      }>(`/dashboard/plants/${plant.id}/drivers`);
      setPlantDriversList(data.drivers || []);
    } catch (err: any) {
      setAlert({
        type: 'error',
        message: err.message || 'Failed to retrieve drivers for this plant.',
      });
      setActiveModal(null);
    } finally {
      setIsModalLoading(false);
    }
  };

  // Click on Drivers for Outside
  const handleOutsideDriversClick = async () => {
    setActiveModal('outsideDrivers');
    setIsModalLoading(true);
    try {
      const data = await apiRequest<{
        title: string;
        drivers: DashboardDriverItem[];
      }>('/dashboard/outside/drivers');
      setOutsideDriversList(data.drivers || []);
    } catch (err: any) {
      setAlert({
        type: 'error',
        message: err.message || 'Failed to retrieve outside drivers.',
      });
      setActiveModal(null);
    } finally {
      setIsModalLoading(false);
    }
  };

  // Export Drivers list to .xls Excel file
  const exportDriversToExcel = (drivers: DashboardDriverItem[], filename: string) => {
    if (drivers.length === 0) return;
    const headers = [
      'Driver Name',
      'Mobile Number',
      'Assigned Vehicle',
      'Status',
      'Plant In Date Time',
      'Readable Location',
      'Last GPS Update',
    ];
    const headerHtml = `<tr>${headers
      .map(
        (h) =>
          `<th style="background-color:#10b981;color:#ffffff;font-weight:bold;padding:10px 14px;border:1px solid #d1d5db;font-family:Arial,sans-serif;font-size:12px;text-align:left;">${escapeXml(
            h
          )}</th>`
      )
      .join('')}</tr>`;

    const rowsHtml = drivers
      .map((d) => {
        const cells = [
          d.driverName,
          `+91 ${d.mobileNumber}`,
          d.vehicleNumber || 'Unassigned',
          d.status,
          d.plantInTime ? formatDateTime(d.plantInTime) : '—',
          d.readableLocation || d.location || '—',
          d.lastLocationAt ? formatDateTime(d.lastLocationAt) : 'Recently',
        ];

        return `<tr>${cells
          .map(
            (c, i) =>
              `<td style="padding:8px 12px;border:1px solid #e5e7eb;font-family:Arial,sans-serif;font-size:11px;vertical-align:top;${
                i === 0 ? 'font-weight:bold;color:#0f172a;' : 'color:#334155;'
              }">${escapeXml(c)}</td>`
          )
          .join('')}</tr>`;
      })
      .join('');

    const excelHtml = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head>
  <meta http-equiv="content-type" content="application/vnd.ms-excel; charset=UTF-8"/>
</head>
<body>
  <table border="1" style="border-collapse:collapse;">
    <thead>${headerHtml}</thead>
    <tbody>${rowsHtml}</tbody>
  </table>
</body>
</html>`;

    const blob = new Blob([excelHtml], { type: 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Requirement 12, 13, 19: Driver sees strictly their own location and status
  if (user?.role === 'Driver') {
    return (
      <AppLayout pageTitle="Driver Telematics Dashboard" requiredPage="Dashboard">
        <DriverDashboardView />
      </AppLayout>
    );
  }

  return (
    <AppLayout pageTitle="Fleet Monitoring Dashboard" requiredPage="Dashboard">
      <div className="space-y-6">
        {/* Top Control Bar */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-2 border-b border-slate-200">
          <div>
            <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
              Fleet Overview
            </h1>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-1">
              <p className="text-xs text-slate-500 flex items-center gap-1.5 font-medium">
                <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span>Last evaluated:</span>
                <strong className="text-slate-800 font-semibold">{formatDateTime(lastUpdated)}</strong>
              </p>
              <span className="text-slate-300 hidden sm:inline">•</span>
              {/* Global 30-Min Fixed Boundary Countdown Badge */}
              <div
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200/90 text-emerald-800 text-xs font-semibold shadow-2xs select-none"
                title="Synchronized to server-side 30-minute IST schedule slots (HH:00 and HH:30 IST)"
              >
                {isBackendSyncing ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 text-emerald-600 animate-spin" />
                    <span className="font-bold text-emerald-700">Syncing GPS...</span>
                  </>
                ) : (
                  <>
                    <span>(Next sync in:</span>
                    <span className="font-mono font-bold text-emerald-700 tracking-tight">{nextSyncCountdown}</span>
                    <span>)</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center flex-wrap gap-2.5">
            {/* Visual Badge: Auto-Sync Active 🟢 / Retrying ⚠️ / Syncing 🔄 */}
            {syncStatusState === 'FAILED' ? (
              <div
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-rose-50 border border-rose-200 rounded-xl text-xs font-bold text-rose-800 shadow-2xs select-none"
                title="Auto-Sync encountered an error and is retrying automatically"
              >
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
                </span>
                <span>Auto-Sync Retrying... ⚠️</span>
              </div>
            ) : isBackendSyncing ? (
              <div
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl text-xs font-bold text-amber-800 shadow-2xs select-none"
                title="Synchronizing live GPS data with Wheelseye server..."
              >
                <RefreshCw className="w-3.5 h-3.5 text-amber-600 animate-spin" />
                <span>Syncing GPS...</span>
              </div>
            ) : (
              <div
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-xl text-xs font-bold text-emerald-800 shadow-2xs select-none"
                title="Automated 24/7 background GPS sync worker runs strictly every 30 minutes (Server-Side)"
              >
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <span>Auto-Sync Active 🟢</span>
              </div>
            )}

            <Link
              href="/sikka-ai"
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl shadow-xs transition cursor-pointer border border-emerald-500/30 group"
            >
              <Sparkles className="w-3.5 h-3.5 text-emerald-400 group-hover:rotate-12 transition-transform" />
              <span>Sikka AI Assistant</span>
            </Link>

            <button
              type="button"
              onClick={handleTriggerSync}
              disabled={isSyncing || isLoading}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 text-slate-950 text-xs font-bold rounded-xl shadow-xs transition cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>{isSyncing ? 'Synchronizing GPS...' : 'Sync GPS Now'}</span>
            </button>
          </div>
        </div>

        {/* Alert Feedback */}
        <AlertBanner alert={alert} onDismiss={() => setAlert(null)} />

        {/* Section Title */}
        <div className="pt-2">
          <h2 className="text-lg font-bold text-slate-900 tracking-tight">
            Geofence Detection Widgets
          </h2>
          <p className="text-xs text-slate-500">
            Click any plant widget or the Outside widget to view detailed vehicle logs and entry timestamps
          </p>
        </div>

        {/* Dynamic Plant Widgets Grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-44 rounded-2xl bg-white border border-slate-200 p-6 animate-pulse"
              >
                <div className="h-5 bg-slate-200 rounded w-1/2 mb-4" />
                <div className="h-10 bg-slate-100 rounded w-1/3 mb-4" />
                <div className="h-4 bg-slate-100 rounded w-3/4" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {/* Dynamic Active Plants */}
            {plantWidgets.map((plant) => (
              <div
                key={plant.id}
                className="group flex flex-col justify-between text-left p-6 rounded-2xl bg-white border border-slate-200/90 hover:border-emerald-500/80 shadow-xs hover:shadow-lg transition-all duration-200 relative overflow-hidden"
              >
                <div className="absolute top-0 right-0 w-2 h-full bg-emerald-500 opacity-80 group-hover:w-3 transition-all" />

                {/* Top Plant Info */}
                <div>
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold">
                        <Building2 className="w-4 h-4" />
                      </div>
                      <h3 className="font-extrabold text-base text-slate-900 group-hover:text-emerald-700 transition">
                        {plant.name}
                      </h3>
                    </div>
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                      Geofenced
                    </span>
                  </div>

                  <p className="text-xs text-slate-500 flex items-center gap-1.5 mt-1 font-medium">
                    <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="truncate">{plant.location}</span>
                  </p>

                  <p className="text-[11px] text-slate-400 mt-1">
                    Radius: <strong className="text-slate-700">{plant.radiusMeter || 500} meters</strong>
                  </p>
                </div>

                {/* Interactive Split Controls: Click Vehicle -> Vehicle Details ONLY | Click Driver -> Driver Details ONLY */}
                <div className="mt-5 pt-4 border-t border-slate-100 grid grid-cols-2 gap-3">
                  {/* Click Vehicle -> Shows Vehicle Records ONLY */}
                  <button
                    type="button"
                    onClick={() => handlePlantClick(plant)}
                    className="flex flex-col justify-between p-3.5 rounded-xl bg-slate-50 hover:bg-emerald-50/90 active:bg-emerald-100/80 border border-slate-200/80 hover:border-emerald-400 text-left transition group/btn cursor-pointer shadow-2xs hover:shadow-xs"
                    title={`Click to view vehicle records only for ${plant.name}`}
                  >
                    <div className="flex items-center justify-between w-full mb-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600 group-hover/btn:text-emerald-800 flex items-center gap-1">
                        <Truck className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Vehicles</span>
                      </span>
                      <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover/btn:text-emerald-700 group-hover/btn:translate-x-0.5 transition-transform" />
                    </div>
                    <div className="flex items-baseline gap-1 mt-1">
                      <span className="text-2xl font-black text-slate-900 group-hover/btn:text-emerald-700 transition">
                        {plant.vehicleCount}
                      </span>
                      <span className="text-[10px] font-bold text-emerald-700">
                        Inside
                      </span>
                    </div>
                    <span className="text-[11px] font-extrabold text-emerald-600 group-hover/btn:text-emerald-800 mt-2 block">
                      View Vehicles &rarr;
                    </span>
                  </button>

                  {/* Click Available Driver -> Shows Driver Records ONLY */}
                  <button
                    type="button"
                    onClick={() => handlePlantDriversClick(plant)}
                    className="flex flex-col justify-between p-3.5 rounded-xl bg-slate-50 hover:bg-indigo-50/90 active:bg-indigo-100/80 border border-slate-200/80 hover:border-indigo-400 text-left transition group/btn cursor-pointer shadow-2xs hover:shadow-xs"
                    title={`Click to view driver records only for ${plant.name}`}
                  >
                    <div className="flex items-center justify-between w-full mb-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600 group-hover/btn:text-indigo-800 flex items-center gap-1">
                        <Users className="w-3.5 h-3.5 text-indigo-600" />
                        <span>Available Drivers</span>
                      </span>
                      <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover/btn:text-indigo-700 group-hover/btn:translate-x-0.5 transition-transform" />
                    </div>
                    <div className="flex items-baseline gap-1 mt-1">
                      <span className="text-2xl font-black text-slate-900 group-hover/btn:text-indigo-700 transition">
                        {plant.driverCount ?? 0}
                      </span>
                      <span className="text-[10px] font-bold text-indigo-700">
                        Available
                      </span>
                    </div>
                    <span className="text-[11px] font-extrabold text-indigo-600 group-hover/btn:text-indigo-800 mt-2 block">
                      View Drivers &rarr;
                    </span>
                  </button>
                </div>
              </div>
            ))}

            {/* Outside Widget */}
            {outsideWidget && (
              <div
                className="group flex flex-col justify-between text-left p-6 rounded-2xl bg-white border border-slate-200/90 hover:border-amber-500/80 shadow-xs hover:shadow-lg transition-all duration-200 relative overflow-hidden"
              >
                <div className="absolute top-0 right-0 w-2 h-full bg-amber-500 opacity-80 group-hover:w-3 transition-all" />

                {/* Top Outside Info */}
                <div>
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center font-bold">
                        <Navigation className="w-4 h-4" />
                      </div>
                      <h3 className="font-extrabold text-base text-slate-900 group-hover:text-amber-700 transition">
                        Outside
                      </h3>
                    </div>
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                      Outside Radius
                    </span>
                  </div>

                  <p className="text-xs text-slate-500 flex items-center gap-1.5 mt-1 font-medium">
                    <Compass className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span>Outside all active plant geofences</span>
                  </p>

                  <p className="text-[11px] text-slate-400 mt-1">
                    Coverage: <strong className="text-slate-700">En route / Open highway</strong>
                  </p>
                </div>

                {/* Interactive Split Controls: Click Vehicle -> Vehicle Details ONLY | Click Driver -> Driver Details ONLY */}
                <div className="mt-5 pt-4 border-t border-slate-100 grid grid-cols-2 gap-3">
                  {/* Click Vehicle -> Shows Outside Vehicle Records ONLY */}
                  <button
                    type="button"
                    onClick={handleOutsideClick}
                    className="flex flex-col justify-between p-3.5 rounded-xl bg-slate-50 hover:bg-amber-50/90 active:bg-amber-100/80 border border-slate-200/80 hover:border-amber-400 text-left transition group/btn cursor-pointer shadow-2xs hover:shadow-xs"
                    title="Click to view vehicle records currently Outside only"
                  >
                    <div className="flex items-center justify-between w-full mb-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600 group-hover/btn:text-amber-800 flex items-center gap-1">
                        <Truck className="w-3.5 h-3.5 text-amber-600" />
                        <span>Vehicles</span>
                      </span>
                      <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover/btn:text-amber-700 group-hover/btn:translate-x-0.5 transition-transform" />
                    </div>
                    <div className="flex items-baseline gap-1 mt-1">
                      <span className="text-2xl font-black text-slate-900 group-hover/btn:text-amber-700 transition">
                        {outsideWidget.vehicleCount}
                      </span>
                      <span className="text-[10px] font-bold text-amber-700">
                        Outside
                      </span>
                    </div>
                    <span className="text-[11px] font-extrabold text-amber-600 group-hover/btn:text-amber-800 mt-2 block">
                      View Vehicles &rarr;
                    </span>
                  </button>

                  {/* Click Available Driver -> Shows Outside Driver Records ONLY */}
                  <button
                    type="button"
                    onClick={handleOutsideDriversClick}
                    className="flex flex-col justify-between p-3.5 rounded-xl bg-slate-50 hover:bg-indigo-50/90 active:bg-indigo-100/80 border border-slate-200/80 hover:border-indigo-400 text-left transition group/btn cursor-pointer shadow-2xs hover:shadow-xs"
                    title="Click to view driver records currently Outside only"
                  >
                    <div className="flex items-center justify-between w-full mb-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600 group-hover/btn:text-indigo-800 flex items-center gap-1">
                        <Users className="w-3.5 h-3.5 text-indigo-600" />
                        <span>Available Drivers</span>
                      </span>
                      <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover/btn:text-indigo-700 group-hover/btn:translate-x-0.5 transition-transform" />
                    </div>
                    <div className="flex items-baseline gap-1 mt-1">
                      <span className="text-2xl font-black text-slate-900 group-hover/btn:text-indigo-700 transition">
                        {outsideWidget.driverCount ?? 0}
                      </span>
                      <span className="text-[10px] font-bold text-indigo-700">
                        En Route
                      </span>
                    </div>
                    <span className="text-[11px] font-extrabold text-indigo-600 group-hover/btn:text-indigo-800 mt-2 block">
                      View Drivers &rarr;
                    </span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Modal: Plant Vehicles Drilldown */}
        <Modal
          isOpen={activeModal === 'plant'}
          onClose={() => setActiveModal(null)}
          title={`${selectedPlant?.name || 'Plant'} – Vehicles`}
          subtitle={`Currently detected inside configured ${selectedPlant?.radiusMeter || 500}m geofence radius`}
          maxWidth="5xl"
        >
          {/* Modal Header Actions: Export to Excel */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 mb-4 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-600">
                Inside Plant: <strong className="text-slate-900">{plantVehicles.length} vehicles</strong>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleTriggerSync}
                disabled={isSyncing}
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-xs font-bold rounded-xl shadow-xs transition cursor-pointer disabled:opacity-50"
                title="Trigger manual GPS sync to fetch latest telemetry for all vehicles"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                <span>{isSyncing ? 'Syncing...' : 'Sync GPS'}</span>
              </button>
              <button
                type="button"
                onClick={exportPlantVehiclesToExcel}
                disabled={plantVehicles.length === 0}
                className="inline-flex items-center justify-center gap-2 px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-xs font-bold rounded-xl shadow-xs transition cursor-pointer disabled:opacity-50"
                title="Download vehicles and plan history as Excel (.xls)"
              >
                <FileSpreadsheet className="w-4 h-4" />
                <span>Export</span>
              </button>
            </div>
          </div>

          {isModalLoading ? (
            <div className="py-12 flex flex-col items-center justify-center">
              <RefreshCw className="w-7 h-7 text-emerald-600 animate-spin mb-2" />
              <p className="text-xs font-semibold text-slate-500">Loading plant vehicles...</p>
            </div>
          ) : plantVehicles.length === 0 ? (
            <div className="py-12 text-center">
              <Building2 className="w-10 h-10 text-slate-300 mx-auto mb-2" />
              <p className="text-sm font-semibold text-slate-700">No vehicles inside this plant</p>
              <p className="text-xs text-slate-500 mt-0.5">
                No active GPS coordinates currently match this plant boundary.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto -mx-6 -my-2">
              <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 font-bold uppercase tracking-wider">
                  <tr>
                    <th className="px-5 py-3">Vehicle Number</th>
                    <th className="px-5 py-3">Entry Date & Time</th>
                    <th className="px-5 py-3">Sync GPS Date Time</th>
                    <th className="px-5 py-3">Stay Hours</th>
                    <th className="px-5 py-3">Location</th>
                    <th className="px-5 py-3 min-w-[260px]">Plan</th>
                    <th className="px-5 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white font-medium">
                  {plantVehicles.map((v) => {
                    const hasPlans = Array.isArray(v.plans) && v.plans.length > 0;
                    const latestPlan = hasPlans ? v.plans![v.plans!.length - 1] : null;
                    const olderPlans =
                      hasPlans && v.plans!.length > 1
                        ? v.plans!.slice(0, -1).reverse()
                        : [];

                    return (
                      <tr key={v.id} className="hover:bg-slate-50/70 transition">
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <VehicleIcon className="w-4 h-4 text-emerald-600 shrink-0" />
                            <span className="font-extrabold text-slate-900 text-sm tracking-wide">
                              {v.vehicleNumber}
                            </span>
                            {v.gps_status === 'GPS STALE' && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300" title="GPS telemetry is older than 60 minutes">
                                GPS STALE
                              </span>
                            )}
                            {v.gps_status === 'GPS SYNC FAILED' && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-300" title="GPS sync failed on last attempt">
                                SYNC FAILED
                              </span>
                            )}
                            {v.gps_status === 'GPS DATA UNAVAILABLE' && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-300" title="Vehicle not in latest telematics stream">
                                NO GPS
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-3.5 text-slate-700 font-semibold whitespace-nowrap">
                          {formatDateTime(v.entryDateTime)}
                        </td>
                        <td className="px-5 py-3.5 text-slate-600 font-medium whitespace-nowrap">
                          <div>
                            <span>{formatDateTime(v.latest_gps_timestamp || v.lastUpdateDateTime || v.entryDateTime)}</span>
                            {v.last_sync_source && (
                              <span className="ml-1.5 text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider bg-slate-100 text-slate-600 border border-slate-200">
                                {v.last_sync_source}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-3.5 whitespace-nowrap">
                          {(() => {
                            const stayHours = calculateStayHours(v.entryDateTime);
                            const colors = getDurationColorClasses(stayHours);
                            return (
                              <span
                                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs border shadow-2xs transition-colors ${colors.badge}`}
                                title={`Stay duration inside plant: ${stayHours} Hrs`}
                              >
                                <Clock className={`w-3.5 h-3.5 shrink-0 ${colors.icon}`} />
                                <span>{stayHours} Hrs</span>
                              </span>
                            );
                          })()}
                        </td>
                        {/* Location Column & Underneath Track Now Button (Redirect to GPS page on click) */}
                        <td className="px-5 py-3.5">
                          <div className="flex flex-col gap-2 min-w-[200px] max-w-[300px]">
                            <div className="flex items-start gap-1.5 text-xs text-slate-800 font-medium leading-snug">
                              <MapPin className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                              <span
                                className="line-clamp-2"
                                title={
                                  v.readableLocation ||
                                  v.location ||
                                  (selectedPlant ? `${selectedPlant.name} Premises, ${selectedPlant.location || 'Uttar Pradesh'}` : 'Inside Plant')
                                }
                              >
                                {v.readableLocation ||
                                  v.location ||
                                  (selectedPlant ? `${selectedPlant.name} Premises, ${selectedPlant.location || 'Uttar Pradesh'}` : 'Inside Plant')}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setActiveModal(null);
                                router.push(`/gps?vehicle=${encodeURIComponent(v.vehicleNumber)}`);
                              }}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 text-slate-950 text-xs font-bold rounded-xl shadow-xs transition cursor-pointer w-fit"
                              title={`Track ${v.vehicleNumber} on GPS live map`}
                            >
                              <Navigation className="w-3.5 h-3.5" />
                              <span>Track Now</span>
                            </button>
                          </div>
                        </td>

                        {/* Plan Column */}
                        <td className="px-5 py-3.5">
                          {!hasPlans ? (
                            <span className="text-slate-400 italic text-[11px]">
                              No plan assigned
                            </span>
                          ) : (
                            <div className="space-y-1.5 max-w-[280px]">
                              {/* Latest Plan */}
                              <div className="text-xs bg-emerald-50/90 p-2 rounded-lg border border-emerald-200/90 text-slate-800 shadow-2xs">
                                <span className="text-[10px] font-bold text-emerald-800 uppercase block tracking-wider">
                                  {v.plans!.length > 1 ? 'New Plan' : 'Plan'} by {latestPlan!.authorName} ({formatDateTime(latestPlan!.createdAt)}):
                                </span>
                                <p className="font-semibold text-slate-900 mt-0.5">
                                  {latestPlan!.planText}
                                </p>
                              </div>

                              {/* Older Plans History (Audit Trail) */}
                              {olderPlans.map((oldPlan, idx) => (
                                <div
                                  key={idx}
                                  className="text-[11px] bg-slate-50 p-1.5 rounded-md border border-slate-200 text-slate-600"
                                >
                                  <span className="text-[9px] font-bold text-slate-500 uppercase block">
                                    Old Plan by {oldPlan.authorName} ({formatDateTime(oldPlan.createdAt)}):
                                  </span>
                                  <p className="italic text-slate-700 mt-0.5">
                                    {oldPlan.planText}
                                  </p>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>

                        {/* Action Column: Add Plan / Edit */}
                        <td className="px-5 py-3.5 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => openPlanModal(v)}
                            className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-xl font-bold text-xs transition cursor-pointer shadow-2xs ${
                              !hasPlans
                                ? 'bg-emerald-500 hover:bg-emerald-600 text-slate-950 shadow-emerald-500/20'
                                : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200'
                            }`}
                          >
                            {!hasPlans ? (
                              <>
                                <Plus className="w-3.5 h-3.5" />
                                <span>Add Plan</span>
                              </>
                            ) : (
                              <>
                                <Edit3 className="w-3.5 h-3.5" />
                                <span>Edit</span>
                              </>
                            )}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Modal>

        {/* Modal: Add / Edit Dispatch Plan */}
        <Modal
          isOpen={isPlanModalOpen}
          onClose={() => !isSavingPlan && setIsPlanModalOpen(false)}
          title={
            selectedVehicleForPlan?.plans && selectedVehicleForPlan.plans.length > 0
              ? `Edit Dispatch Plan – ${selectedVehicleForPlan?.vehicleNumber}`
              : `Add Dispatch Plan – ${selectedVehicleForPlan?.vehicleNumber}`
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
            {/* If vehicle has previous plan history, show it */}
            {selectedVehicleForPlan?.plans && selectedVehicleForPlan.plans.length > 0 && (
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 max-h-36 overflow-y-auto space-y-1.5 mb-2">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                  Existing Plan History
                </span>
                {selectedVehicleForPlan.plans.slice().reverse().map((p, idx) => (
                  <div key={idx} className="text-xs bg-white p-2 rounded-lg border border-slate-200/80">
                    <span className="text-[10px] font-bold text-slate-600 block">
                      {idx === 0 ? 'Current Plan' : `Previous Revision`} by {p.authorName} ({formatDateTime(p.createdAt)}):
                    </span>
                    <p className="text-slate-800 font-medium mt-0.5">{p.planText}</p>
                  </div>
                ))}
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                {selectedVehicleForPlan?.plans && selectedVehicleForPlan.plans.length > 0
                  ? 'New Plan (approx. 20 words) *'
                  : 'Vehicle Plan (approx. 20 words) *'}
              </label>
              <textarea
                rows={3}
                value={planInput}
                onChange={(e) => setPlanInput(e.target.value)}
                placeholder="e.g. This vehicle will load for Ghaziabad"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-medium focus:border-emerald-500 focus:outline-hidden"
                disabled={isSavingPlan}
                required
              />
              <div className="flex items-center justify-between text-[11px] text-slate-400 mt-1">
                <span>Example: &ldquo;This vehicle will load for Ghaziabad&rdquo;</span>
                <span>
                  {planInput.trim().split(/\s+/).filter(Boolean).length} words
                </span>
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
                {isSavingPlan ? 'Saving...' : 'Save Plan'}
              </button>
            </div>
          </form>
        </Modal>

        {/* Modal: Outside Vehicles Drilldown (Requirement 24) */}
        <Modal
          isOpen={activeModal === 'outside'}
          onClose={() => setActiveModal(null)}
          title="Outside – Vehicles"
          subtitle="All vehicles that are currently classified as Outside all configured Plant radii"
          maxWidth="5xl"
        >
          {/* Outside Modal Header Actions: Export */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 mb-4 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-600">
                Outside Vehicles: <strong className="text-slate-900">{outsideVehicles.length} vehicles</strong>
              </span>
            </div>
            <button
              type="button"
              onClick={exportOutsideVehiclesToExcel}
              disabled={outsideVehicles.length === 0}
              className="inline-flex items-center justify-center gap-2 px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white text-xs font-bold rounded-xl shadow-xs transition cursor-pointer disabled:opacity-50"
              title="Download outside vehicles list as Excel (.xls)"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>Export</span>
            </button>
          </div>

          {isModalLoading ? (
            <div className="py-12 flex flex-col items-center justify-center">
              <RefreshCw className="w-7 h-7 text-amber-600 animate-spin mb-2" />
              <p className="text-xs font-semibold text-slate-500">Loading outside vehicles...</p>
            </div>
          ) : outsideVehicles.length === 0 ? (
            <div className="py-12 text-center">
              <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
              <p className="text-sm font-semibold text-slate-700">All vehicles are inside plants</p>
              <p className="text-xs text-slate-500 mt-0.5">
                No active registered vehicles are currently outside geofences.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto -mx-6 -my-2">
              <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 font-bold uppercase tracking-wider">
                  <tr>
                    <th className="px-5 py-3">Vehicle Number</th>
                    <th className="px-5 py-3">Last Out Plant Name</th>
                    <th className="px-5 py-3">Plant Out Date Time</th>
                    <th className="px-5 py-3">Last Location Date Time</th>
                    <th className="px-5 py-3">Outside Hour</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Driver Name-Mobile</th>
                    <th className="px-5 py-3 text-center">GPS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white font-medium">
                  {outsideVehicles.map((v) => {
                    const plantOutTime = v.plantOutDateTime || v.lastLocationDateTime || v.lastLocationTime;
                    const lastGpsTime = v.lastLocationDateTime || v.lastLocationTime;
                    const outPlantName = v.lastOutPlantName || 'Tea Plant';

                    return (
                      <tr key={v.id} className="hover:bg-slate-50/70 transition">
                        {/* 1. Vehicle Number */}
                        <td className="px-5 py-3.5 whitespace-nowrap">
                          <div className="flex items-center gap-2 flex-wrap">
                            <VehicleIcon className="w-4 h-4 text-amber-600 shrink-0" />
                            <span className="font-extrabold text-slate-900 text-sm tracking-wide">
                              {v.vehicleNumber}
                            </span>
                            {v.gps_status === 'GPS STALE' && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300" title="GPS telemetry is older than 60 minutes">
                                GPS STALE
                              </span>
                            )}
                            {v.gps_status === 'GPS SYNC FAILED' && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-300" title="GPS sync failed on last attempt">
                                SYNC FAILED
                              </span>
                            )}
                            {v.gps_status === 'GPS DATA UNAVAILABLE' && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-300" title="Vehicle not in latest telematics stream">
                                NO GPS
                              </span>
                            )}
                          </div>
                        </td>

                        {/* 2. Last Out Plant Name */}
                        <td className="px-5 py-3.5 whitespace-nowrap">
                          <span className="font-bold text-slate-800">
                            {outPlantName}
                          </span>
                        </td>

                        {/* 3. Plant Out Date Time */}
                        <td className="px-5 py-3.5 text-slate-700 whitespace-nowrap font-medium">
                          {formatDateTime(plantOutTime)}
                        </td>

                        {/* 4. Last Location Date Time */}
                        <td className="px-5 py-3.5 text-slate-700 whitespace-nowrap font-medium">
                          <div>
                            <span>{formatDateTime(v.latest_gps_timestamp || lastGpsTime)}</span>
                            {v.last_sync_source && (
                              <span className="ml-1.5 text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider bg-slate-100 text-slate-600 border border-slate-200">
                                {v.last_sync_source}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Outside Hour (left side of Status) */}
                        <td className="px-5 py-3.5 whitespace-nowrap">
                          {(() => {
                            const outsideHour = calculateOutsideHours(plantOutTime);
                            const colors = getDurationColorClasses(outsideHour);
                            return (
                              <span
                                className={`inline-flex items-center px-2.5 py-0.5 rounded-md font-mono text-xs border shadow-2xs tracking-tight transition-colors ${colors.badge}`}
                                title={`Duration outside all plants: ${outsideHour}`}
                              >
                                <span>{outsideHour}</span>
                              </span>
                            );
                          })()}
                        </td>

                        {/* 5. Status */}
                        <td className="px-5 py-3.5 whitespace-nowrap">
                          <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                            Outside
                          </span>
                        </td>

                        {/* 6. Driver Name-Mobile (Requirement 24.2 - 24.6) */}
                        <td className="px-5 py-3.5">
                          <NearestDriverCell
                            driverName={v.driverName}
                            mobile={v.mobile}
                            driverDistance={v.driverDistance}
                            multipleDrivers={v.multipleDrivers}
                            nearestDrivers={v.nearestDrivers}
                            locationStale={v.locationStale}
                            onViewMultiple={(drivers) => {
                              setSelectedNearestDrivers(drivers);
                              setDriversModalTitle(`Available Drivers Near ${v.vehicleNumber} (Within 100m)`);
                              setIsDriversModalOpen(true);
                            }}
                          />
                        </td>

                        {/* 7. GPS: [ Track Now ] (Requirement 24.7) */}
                        <td className="px-5 py-3.5 text-center whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => {
                              setActiveModal(null);
                              router.push(`/gps?vehicle=${encodeURIComponent(v.vehicleNumber)}`);
                            }}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 text-slate-950 text-xs font-bold rounded-xl shadow-xs transition cursor-pointer"
                            title={`Track live location for ${v.vehicleNumber}`}
                          >
                            <Navigation className="w-3.5 h-3.5" />
                            <span>Track Now</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Modal>

        {/* Modal: Plant & Outside Drivers Drilldown (Driver Records ONLY) */}
        <Modal
          isOpen={activeModal === 'plantDrivers' || activeModal === 'outsideDrivers'}
          onClose={() => setActiveModal(null)}
          title={activeModal === 'plantDrivers' ? `${selectedPlant?.name || 'Plant'} – Available Drivers` : 'Outside – Available Drivers'}
          subtitle={
            activeModal === 'plantDrivers'
              ? `Registered drivers currently operating or detected inside ${selectedPlant?.name || 'this plant'} perimeter (driver records only)`
              : 'Registered drivers currently operating or detected outside all plant geofences (driver records only)'
          }
          maxWidth="5xl"
        >
          {/* Header Action: Export Drivers to Excel */}
          {(() => {
            const currentList = activeModal === 'plantDrivers' ? plantDriversList : outsideDriversList;
            const exportFileName =
              activeModal === 'plantDrivers'
                ? `${(selectedPlant?.name || 'Plant').replace(/[^a-zA-Z0-9_-]/g, '_')}_Drivers_${new Date().toISOString().slice(0, 10)}.xls`
                : `Outside_Drivers_${new Date().toISOString().slice(0, 10)}.xls`;

            return (
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 mb-4 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-600">
                    Active Drivers: <strong className="text-slate-900">{currentList.length} drivers</strong>
                  </span>
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                    {activeModal === 'plantDrivers' ? 'Inside Plant' : 'En Route / Outside'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => exportDriversToExcel(currentList, exportFileName)}
                  disabled={currentList.length === 0}
                  className="inline-flex items-center justify-center gap-2 px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-xs font-bold rounded-xl shadow-xs transition cursor-pointer disabled:opacity-50"
                  title="Download drivers list as Excel (.xls)"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  <span>Export</span>
                </button>
              </div>
            );
          })()}

          {isModalLoading ? (
            <div className="py-12 flex flex-col items-center justify-center">
              <RefreshCw className="w-7 h-7 text-emerald-600 animate-spin mb-2" />
              <p className="text-xs font-semibold text-slate-500">Loading drivers list...</p>
            </div>
          ) : (() => {
            const currentList = activeModal === 'plantDrivers' ? plantDriversList : outsideDriversList;
            if (currentList.length === 0) {
              return (
                <div className="py-12 text-center">
                  <Users className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                  <p className="text-sm font-semibold text-slate-700">No Available Drivers</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {activeModal === 'plantDrivers'
                      ? `No registered drivers are currently located inside ${selectedPlant?.name || 'this plant'}.`
                      : 'No registered drivers are currently operating outside plant perimeters.'}
                  </p>
                </div>
              );
            }

            return (
              <div className="overflow-x-auto -mx-6 -my-2">
                <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 font-bold uppercase tracking-wider">
                    <tr>
                      <th className="px-5 py-3">Driver Name</th>
                      <th className="px-5 py-3">Mobile Number</th>
                      <th className="px-5 py-3">Assigned Vehicle</th>
                      <th className="px-5 py-3">Status</th>
                      <th className="px-5 py-3">Plant In Date &amp; Time</th>
                      <th className="px-5 py-3">Last GPS Update</th>
                      <th className="px-5 py-3 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white font-medium">
                    {currentList.map((d) => (
                      <tr key={d.id} className="hover:bg-slate-50/70 transition">
                        {/* Driver Name */}
                        <td className="px-5 py-3.5 whitespace-nowrap">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-full bg-slate-100 text-slate-700 font-bold flex items-center justify-center text-xs border border-slate-200 shrink-0 overflow-hidden shadow-2xs">
                              {d.photo ? (
                                <img
                                  src={d.photo}
                                  alt={d.driverName}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <span>{d.driverName ? d.driverName.charAt(0).toUpperCase() : 'D'}</span>
                              )}
                            </div>
                            <span className="font-extrabold text-slate-900 text-sm">
                              {d.driverName || 'Fleet Driver'}
                            </span>
                          </div>
                        </td>

                        {/* Mobile Number */}
                        <td className="px-5 py-3.5 whitespace-nowrap">
                          {d.mobileNumber ? (
                            <a
                              href={`tel:${d.mobileNumber}`}
                              className="inline-flex items-center gap-1.5 text-slate-700 hover:text-emerald-700 font-mono font-bold transition"
                            >
                              <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                              <span>+91 {d.mobileNumber}</span>
                            </a>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>

                        {/* Assigned Vehicle */}
                        <td className="px-5 py-3.5 whitespace-nowrap">
                          {d.vehicleNumber && d.vehicleNumber !== 'Unassigned' ? (
                            <div className="flex items-center gap-1.5 font-bold text-slate-900">
                              <VehicleIcon className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                              <span>{d.vehicleNumber}</span>
                            </div>
                          ) : (
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-slate-100 text-slate-500">
                              Unassigned
                            </span>
                          )}
                        </td>

                        {/* Status */}
                        <td className="px-5 py-3.5 whitespace-nowrap">
                          <span
                            className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${
                              d.status === 'Inside'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {d.status}
                          </span>
                        </td>

                        {/* Plant In Date & Time */}
                        <td className="px-5 py-3.5 whitespace-nowrap">
                          {d.plantInTime ? (
                            <div className="flex items-center gap-1.5 text-slate-800 font-mono text-xs font-semibold">
                              <Calendar className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                              <span>{formatDateTime(d.plantInTime)}</span>
                            </div>
                          ) : (
                            <span className="text-slate-400 font-mono text-xs">—</span>
                          )}
                        </td>

                        {/* Last GPS Update & Readable Location with Track Button */}
                        <td className="px-5 py-3.5 text-xs">
                          <div className="space-y-1 max-w-sm">
                            {/* Readable Location */}
                            <div className="flex items-start gap-1.5 font-semibold text-slate-900 leading-snug">
                              <MapPin className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                              <span>
                                {d.readableLocation || d.location || (d.distanceMeters !== undefined ? `${d.distanceMeters}m from plant center` : 'Inside Plant')}
                              </span>
                            </div>

                            {/* Timestamp */}
                            <div className="flex items-center gap-1.5 text-[11px] text-slate-500 font-mono">
                              <Clock className="w-3 h-3 text-slate-400 shrink-0" />
                              <span>{d.lastLocationAt ? formatDateTime(d.lastLocationAt) : 'Recently updated'}</span>
                            </div>

                            {/* Track Button: Directly opens Google Maps */}
                            {(() => {
                              const mapsUrl = (typeof d.latitude === 'number' && typeof d.longitude === 'number')
                                ? `https://maps.google.com/?q=${d.latitude},${d.longitude}`
                                : `https://maps.google.com/?q=${encodeURIComponent(d.readableLocation || d.location || d.plantName || 'Plant Location')}`;

                              return (
                                <a
                                  href={mapsUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-xs font-bold rounded-xl shadow-xs transition cursor-pointer w-fit mt-1"
                                  title="Track driver location on Google Maps"
                                >
                                  <Navigation className="w-3.5 h-3.5 shrink-0" />
                                  <span>Track</span>
                                  <ExternalLink className="w-3 h-3 opacity-90 shrink-0" />
                                </a>
                              );
                            })()}
                          </div>
                        </td>

                        {/* Action */}
                        <td className="px-5 py-3.5 text-center whitespace-nowrap">
                          {d.mobileNumber ? (
                            <a
                              href={`tel:${d.mobileNumber}`}
                              className="inline-flex items-center gap-1 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition cursor-pointer"
                              title={`Call ${d.driverName}`}
                            >
                              <Phone className="w-3 h-3 text-slate-500" />
                              <span>Call</span>
                            </a>
                          ) : (
                            <span className="text-slate-300 text-xs">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })()}
        </Modal>

        {/* Modal: Nearest Drivers Popup (Requirement 23.3 & 23.10) */}
        <NearestDriversModal
          isOpen={isDriversModalOpen}
          onClose={() => setIsDriversModalOpen(false)}
          title={driversModalTitle}
          drivers={selectedNearestDrivers}
        />
      </div>
    </AppLayout>
  );
}

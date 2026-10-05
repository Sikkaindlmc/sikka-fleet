'use client';

import React from 'react';
import { useDriverLocation } from '../hooks/useDriverLocation';
import DriverPlantWidget from './DriverPlantWidget';
import DriverOutsideWidget from './DriverOutsideWidget';
import DriverLocationCard from './DriverLocationCard';
import { Truck, Sparkles } from 'lucide-react';

export default function DriverDashboardView() {
  const {
    summary,
    isLoading,
    isRefreshing,
    isStale,
    locationDeductionStatus,
    locationError,
    refreshLocationNow,
  } = useDriverLocation(true);

  if (isLoading && !summary) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-slate-400">
        <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 text-emerald-500 flex items-center justify-center mb-3 animate-pulse">
          <Truck className="w-5 h-5" />
        </div>
        <p className="text-xs font-semibold">Loading Driver Telematics...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Driver Dashboard Greeting Banner */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-6 bg-white rounded-3xl border border-slate-200 shadow-xs">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold text-emerald-600 uppercase tracking-wider mb-1">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Driver Portal • Sikka LMC</span>
          </div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">
            Driver Telematics & Geofence
          </h1>
          <p className="text-xs text-slate-500 mt-1 max-w-2xl">
            Real-time automated Plant IN/OUT tracking using your device GPS coordinates. Only your own verified location and attendance records are accessible.
          </p>
        </div>

        <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 text-slate-700 rounded-full text-xs font-bold border border-slate-200">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          <span>Driver Dashboard Only</span>
        </div>
      </div>

      {/* Main Status: Plant Widget (Inside) OR Outside Widget (Outside) */}
      {summary?.isInside && summary.currentPlant ? (
        <DriverPlantWidget summary={summary} />
      ) : (
        <DriverOutsideWidget summary={summary || {
          driver: { id: '', driverName: '', dlNumber: '', mobileNumber: '', status: 'Active' },
          currentStatus: 'Outside',
          isInside: false,
          isOutside: true,
          currentPlant: null,
          inTime: null,
          outTime: null,
          lastLocation: null,
          lastLocationUpdateAt: null,
          locationDeductionStatus: 'Location Not Deducted',
          isLocationDeducted: false,
          lastLocationAttemptAt: null,
          lastLocationError: null,
          isStale: false,
          refreshIntervalMinutes: 20,
          serverTime: new Date().toISOString(),
        }} />
      )}

      {/* Driver Location Telematics Card (20-Min Cycle & Refresh) */}
      <DriverLocationCard
        summary={summary}
        isRefreshing={isRefreshing}
        isStale={isStale}
        locationDeductionStatus={locationDeductionStatus}
        locationError={locationError}
        onRefreshNow={refreshLocationNow}
      />
    </div>
  );
}

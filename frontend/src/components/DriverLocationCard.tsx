'use client';

import React from 'react';
import {
  Radio,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Clock,
  User,
  CreditCard,
  Phone,
  Shield,
  Smartphone,
} from 'lucide-react';
import { formatDateTime } from '../lib/formatters';
import { DriverLocationSummary } from '../hooks/useDriverLocation';

interface DriverLocationCardProps {
  summary: DriverLocationSummary | null;
  isRefreshing: boolean;
  isStale: boolean;
  locationError: string | null;
  onRefreshNow: () => void;
}

export default function DriverLocationCard({
  summary,
  isRefreshing,
  isStale,
  locationError,
  onRefreshNow,
}: DriverLocationCardProps) {
  const driver = summary?.driver;
  const lastUpdateAt = summary?.lastLocationUpdateAt;

  return (
    <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-6">
      {/* Header with 20-min cycle pulse */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-600 flex items-center justify-center shrink-0">
            <Radio className="w-5 h-5 text-emerald-600 animate-pulse" />
          </div>
          <div>
            <h3 className="text-base font-black text-slate-900">
              Live Driver Telematics
            </h3>
            <p className="text-xs text-slate-500">
              Automatic 20-minute GPS refresh cycle active
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onRefreshNow}
          disabled={isRefreshing}
          className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 text-slate-950 text-xs font-bold rounded-xl shadow-sm transition cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          <span>{isRefreshing ? 'Acquiring GPS...' : 'Refresh GPS Now'}</span>
        </button>
      </div>

      {/* Driver Identity Card (Requirement 18 & 19) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-4 rounded-2xl bg-slate-50 border border-slate-200/80 text-xs">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-600">
            <User className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="min-w-0">
            <span className="text-[10px] uppercase font-bold text-slate-400 block">
              Driver Name
            </span>
            <span className="font-bold text-slate-900 truncate block">
              {driver?.driverName || 'Driver'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-600">
            <CreditCard className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="min-w-0">
            <span className="text-[10px] uppercase font-bold text-slate-400 block">
              DL Number
            </span>
            <span className="font-mono font-bold text-slate-900 truncate block">
              {driver?.dlNumber || '—'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-600">
            <Phone className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="min-w-0">
            <span className="text-[10px] uppercase font-bold text-slate-400 block">
              Mobile Number
            </span>
            <span className="font-bold text-slate-900 truncate block">
              {driver?.mobileNumber ? `+91 ${driver.mobileNumber}` : '—'}
            </span>
          </div>
        </div>
      </div>

      {/* Freshness & Stale Alert (Requirement 17) */}
      {isStale ? (
        <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-xs">
            <span className="font-bold text-amber-900 block">
              Location Stale Warning
            </span>
            <p className="text-amber-700 mt-0.5 leading-relaxed">
              Last GPS update was received {lastUpdateAt ? `at ${formatDateTime(lastUpdateAt)}` : 'over 25 minutes ago'}.
              Device GPS execution may have been restricted while app was in background. Click &ldquo;Refresh GPS Now&rdquo; to sync your current position.
            </p>
          </div>
        </div>
      ) : (
        <div className="p-3.5 rounded-2xl bg-emerald-50/70 border border-emerald-200 flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-emerald-800 font-semibold">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>GPS Location Fresh: Last refreshed at {lastUpdateAt ? formatDateTime(lastUpdateAt) : 'Recently'}</span>
          </div>
          <span className="text-[11px] font-bold text-emerald-700 bg-white px-2.5 py-1 rounded-full border border-emerald-200 shadow-2xs">
            Active Cycle
          </span>
        </div>
      )}

      {/* Optional Location Error Notice */}
      {locationError && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700">
          <strong>Notice:</strong> {locationError}
        </div>
      )}

      {/* Background Persistence Guarantee (Requirement 17) */}
      <div className="flex items-start gap-2.5 p-3 rounded-xl bg-slate-50 text-[11px] text-slate-500 leading-relaxed border border-slate-100">
        <Smartphone className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
        <span>
          <strong>Background Session:</strong> Your driver session remains active if this window is minimized or when you switch apps. You will only be logged out when you explicitly click <strong>Logout</strong>.
        </span>
      </div>
    </div>
  );
}

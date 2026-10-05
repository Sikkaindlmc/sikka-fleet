'use client';

import React from 'react';
import {
  Radio,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  User,
  CreditCard,
  Phone,
  Smartphone,
  MapPin,
} from 'lucide-react';
import { formatDateTime } from '../lib/formatters';
import { DriverLocationSummary } from '../hooks/useDriverLocation';

interface DriverLocationCardProps {
  summary: DriverLocationSummary | null;
  isRefreshing: boolean;
  isStale: boolean;
  locationDeductionStatus?: 'Location Deducted' | 'Location Not Deducted';
  locationError: string | null;
  onRefreshNow: () => void;
}

export default function DriverLocationCard({
  summary,
  isRefreshing,
  isStale,
  locationDeductionStatus,
  locationError,
  onRefreshNow,
}: DriverLocationCardProps) {
  const driver = summary?.driver;
  const lastLocation = summary?.lastLocation;
  const lastUpdateAt = summary?.lastLocationUpdateAt;

  const currentStatus =
    locationDeductionStatus ||
    summary?.locationDeductionStatus ||
    (isStale ? 'Location Not Deducted' : 'Location Deducted');

  const isDeducted = currentStatus === 'Location Deducted';

  return (
    <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-6">
      {/* Header with 20-min cycle status and trigger */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-2xl border flex items-center justify-center shrink-0 ${
              isDeducted
                ? 'bg-emerald-50 border-emerald-200 text-emerald-600'
                : 'bg-amber-50 border-amber-200 text-amber-600'
            }`}
          >
            <Radio className={`w-5 h-5 ${isDeducted ? 'animate-pulse text-emerald-600' : 'text-amber-600'}`} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-black text-slate-900">
                Driver Location Auto-Tracking
              </h3>
              {/* Requirements 4 & 5 Status Badge */}
              <span
                className={`inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full text-xs font-black uppercase tracking-wider ${
                  isDeducted
                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                    : 'bg-rose-100 text-rose-800 border border-rose-300'
                }`}
              >
                {isDeducted ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Location Deducted</span>
                  </>
                ) : (
                  <>
                    <XCircle className="w-3.5 h-3.5 text-rose-600" />
                    <span>Location Not Deducted</span>
                  </>
                )}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Automatic 20-minute GPS deduction interval continues while driver is active
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
          <span>{isRefreshing ? 'Deducting Location...' : 'Deduct Location Now'}</span>
        </button>
      </div>

      {/* Driver Identity (Requirement 5: Driver Name & User/Driver ID) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-4 rounded-2xl bg-slate-50 border border-slate-200/80 text-xs">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-600 shrink-0">
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
          <div className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-600 shrink-0">
            <CreditCard className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="min-w-0">
            <span className="text-[10px] uppercase font-bold text-slate-400 block">
              DL / Driver ID
            </span>
            <span className="font-mono font-bold text-slate-900 truncate block">
              {driver?.dlNumber || '—'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-600 shrink-0">
            <Phone className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="min-w-0">
            <span className="text-[10px] uppercase font-bold text-slate-400 block">
              Registered Mobile
            </span>
            <span className="font-bold text-slate-900 truncate block">
              {driver?.mobileNumber ? `+91 ${driver.mobileNumber}` : '—'}
            </span>
          </div>
        </div>
      </div>

      {/* Valid Location Record Details (Requirement 5: Lat, Long, Date & Time, Accuracy, Status) */}
      {isDeducted && lastLocation ? (
        <div className="p-4 rounded-2xl bg-emerald-50/70 border border-emerald-200 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 text-emerald-900 font-bold">
              <MapPin className="w-4 h-4 text-emerald-600" />
              <span>Current GPS Coordinates:</span>
              <span className="font-mono bg-white px-2 py-0.5 rounded border border-emerald-200 text-slate-900">
                {lastLocation.latitude.toFixed(5)}, {lastLocation.longitude.toFixed(5)}
              </span>
            </div>

            {typeof lastLocation.accuracy === 'number' && (
              <span className="text-[11px] font-semibold text-emerald-800 bg-emerald-100/80 px-2 py-0.5 rounded-full">
                Accuracy: &plusmn;{Math.round(lastLocation.accuracy)}m
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-emerald-700 pt-2 border-t border-emerald-200/60">
            <div className="flex items-center gap-1.5 font-medium">
              <Clock className="w-3.5 h-3.5 text-emerald-600" />
              <span>
                Location Deducted At:{' '}
                <strong>
                  {lastLocation.capturedAt ? formatDateTime(lastLocation.capturedAt) : formatDateTime(lastUpdateAt)}
                </strong>
              </span>
            </div>
            <span className="font-bold text-emerald-800 bg-white px-2.5 py-0.5 rounded-full border border-emerald-200">
              Status: Location Deducted
            </span>
          </div>
        </div>
      ) : (
        /* Requirements 2, 3, 4: Location Not Deducted Alert (No false location records) */
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 flex items-start gap-3">
          <XCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          <div className="text-xs space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-bold text-rose-900 text-sm">
                Status: Location Not Deducted
              </span>
            </div>
            <p className="text-rose-700 leading-relaxed">
              GPS location could not be fetched at the scheduled 20-minute interval. In accordance with safety rules, no location record was created, and previous locations are never reused as current.
            </p>
            {lastLocation && (
              <p className="text-[11px] text-slate-500 mt-1">
                Last verified GPS fix was at {formatDateTime(lastLocation.capturedAt || lastUpdateAt)}.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Optional Location Error Notice */}
      {locationError && (
        <div className="p-3 rounded-xl bg-slate-100 border border-slate-200 text-xs text-slate-700 flex items-center justify-between gap-2">
          <span>
            <strong>Fetch Status Notice:</strong> {locationError}
          </span>
          <span className="text-[10px] font-bold text-rose-600 uppercase bg-rose-50 px-2 py-0.5 rounded border border-rose-200 shrink-0">
            Location Not Deducted
          </span>
        </div>
      )}

      {/* Background Persistence Guarantee */}
      <div className="flex items-start gap-2.5 p-3 rounded-xl bg-slate-50 text-[11px] text-slate-500 leading-relaxed border border-slate-100">
        <Smartphone className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
        <span>
          <strong>20-Minute Auto-Deduction:</strong> The system automatically queries your device GPS every 20 minutes while you are logged in. If location access is blocked or unavailable, the status will immediately reflect <strong>Location Not Deducted</strong>.
        </span>
      </div>
    </div>
  );
}

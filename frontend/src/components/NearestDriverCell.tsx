'use client';

import React from 'react';
import { User, Phone, Users, Compass, Eye } from 'lucide-react';
import { NearestDriverItem } from './NearestDriversModal';

interface NearestDriverCellProps {
  driverName?: string | null;
  mobile?: string | null;
  driverDistance?: number | null;
  multipleDrivers?: boolean;
  nearestDrivers?: NearestDriverItem[];
  isStale?: boolean;
  locationStale?: boolean;
  onViewMultiple?: (drivers: NearestDriverItem[]) => void;
}

export default function NearestDriverCell({
  driverName,
  mobile,
  driverDistance,
  multipleDrivers,
  nearestDrivers = [],
  isStale,
  locationStale,
  onViewMultiple,
}: NearestDriverCellProps) {
  // Case 0: Stale / Unavailable Driver GPS (Requirement 24.6)
  if (isStale || locationStale) {
    return (
      <span
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-semibold"
        title="Driver's latest GPS information is stale or unavailable"
      >
        <span>Driver Location Unavailable / Stale</span>
      </span>
    );
  }

  // Case 2: Multiple Drivers within 100m (Requirement 24.4)
  if (multipleDrivers || (nearestDrivers && nearestDrivers.length > 1)) {
    return (
      <div className="flex items-center gap-2">
        <span className="font-bold text-slate-800 text-xs">
          Multiple Drivers
        </span>
        {onViewMultiple && (
          <button
            type="button"
            onClick={() => onViewMultiple(nearestDrivers)}
            className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-900 hover:bg-slate-800 active:bg-slate-950 text-white text-[11px] font-bold rounded-lg shadow-2xs transition cursor-pointer"
            title="View all available drivers within 100 meters"
          >
            <Eye className="w-3 h-3" />
            <span>View</span>
          </button>
        )}
      </div>
    );
  }

  // Case 1: Exactly One Driver within 100m (Requirement 24.3)
  if (driverName || (nearestDrivers && nearestDrivers.length === 1)) {
    const singleDriver = nearestDrivers && nearestDrivers.length === 1 ? nearestDrivers[0] : null;
    const name = singleDriver ? singleDriver.driverName : driverName;
    const phone = singleDriver ? singleDriver.mobileNumber : mobile;
    const dist = singleDriver ? singleDriver.distanceMeters : driverDistance;

    return (
      <div className="flex flex-col space-y-0.5">
        <div className="flex items-center gap-1.5 font-bold text-slate-900 text-xs">
          <User className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
          <span className="truncate max-w-[140px]">{name}</span>
          {typeof dist === 'number' && (
            <span className="inline-flex items-center text-[10px] font-mono font-bold bg-emerald-50 text-emerald-800 border border-emerald-200/60 px-1.5 py-0.2 rounded shrink-0">
              {dist}m
            </span>
          )}
        </div>
        {phone && (
          <a
            href={`tel:${phone}`}
            className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-emerald-700 font-mono transition"
          >
            <Phone className="w-3 h-3 text-slate-400 shrink-0" />
            <span>+91 {phone}</span>
          </a>
        )}
      </div>
    );
  }

  // Case 3: No Driver within 100m (Requirement 24.5)
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-100 text-slate-400 text-[11px] font-medium"
      title="No active driver available within 100 meters radius"
    >
      <User className="w-3 h-3 text-slate-400" />
      <span>No Driver Available</span>
    </span>
  );
}

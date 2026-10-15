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
  vehicleNumber?: string;
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
  vehicleNumber,
  onViewMultiple,
}: NearestDriverCellProps) {
  // Case 0: Stale / Unavailable Driver GPS (Rule E)
  if (isStale || locationStale) {
    return (
      <span
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-[11px] font-bold"
        title="Driver's GPS was not deducted at the scheduled interval or is outdated"
      >
        <span>Location Not Deducted</span>
      </span>
    );
  }

  // Case 2: Multiple Drivers within Radius (Section 4: "{N} Drivers Found | View Drivers")
  const hasMultiple = multipleDrivers || (nearestDrivers && nearestDrivers.length > 1);
  if (hasMultiple) {
    const count = nearestDrivers && nearestDrivers.length > 1 ? nearestDrivers.length : 2;

    return (
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-extrabold text-amber-900 text-xs bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-lg shadow-2xs">
          {count} Drivers Found
        </span>
        {onViewMultiple && (
          <button
            type="button"
            onClick={() => onViewMultiple(nearestDrivers)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-slate-900 hover:bg-slate-800 active:bg-slate-950 text-white text-[11px] font-bold rounded-lg shadow-2xs transition cursor-pointer"
            title={`View all ${count} matching drivers within configured radius`}
          >
            <Eye className="w-3 h-3 text-emerald-400" />
            <span>View Drivers</span>
          </button>
        )}
      </div>
    );
  }

  // Case 1: Exactly One Driver within Radius (Rule A)
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
            <span
              className="inline-flex items-center text-[10px] font-mono font-bold bg-emerald-50 text-emerald-800 border border-emerald-200/60 px-1.5 py-0.2 rounded shrink-0 shadow-2xs"
              title={`Distance from vehicle: ${dist} meters`}
            >
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

  // Case 3: No Driver within Radius (Rule D)
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-100 text-slate-400 text-[11px] font-medium"
      title="No active driver available within configured radius"
    >
      <User className="w-3 h-3 text-slate-400" />
      <span>No Driver Available</span>
    </span>
  );
}

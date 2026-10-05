'use client';

import React from 'react';
import { Building2, Clock, MapPin, CheckCircle2, ShieldCheck, Compass } from 'lucide-react';
import { formatDateTime } from '../lib/formatters';
import { DriverLocationSummary } from '../hooks/useDriverLocation';

interface DriverPlantWidgetProps {
  summary: DriverLocationSummary;
}

export default function DriverPlantWidget({ summary }: DriverPlantWidgetProps) {
  const { currentPlant, inTime, lastLocation } = summary;

  return (
    <div className="bg-gradient-to-br from-emerald-950 via-slate-900 to-slate-900 text-white rounded-3xl p-6 sm:p-8 border border-emerald-500/30 shadow-2xl relative overflow-hidden">
      {/* Decorative backdrop glow */}
      <div className="absolute -top-24 -right-24 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10">
        {/* Header Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-6 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center shrink-0 shadow-lg shadow-emerald-500/10">
              <Building2 className="w-6 h-6 text-emerald-400" />
            </div>
            <div>
              <span className="text-[11px] font-bold text-emerald-400 uppercase tracking-widest block">
                Current Plant Status
              </span>
              <h2 className="text-2xl font-black text-white tracking-tight">
                {currentPlant?.name || 'Plant Detected'}
              </h2>
            </div>
          </div>

          <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-bold shadow-sm">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            <span>Currently Inside Plant</span>
          </span>
        </div>

        {/* Plant Details & Auto IN Time */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 my-6">
          {/* Automatic Plant IN Record */}
          <div className="p-4 rounded-2xl bg-slate-800/60 border border-slate-700/60">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-400 mb-1.5">
              <Clock className="w-4 h-4 text-emerald-400" />
              <span>Automatic Plant IN Timestamp</span>
            </div>
            <p className="text-lg font-black text-emerald-300">
              {inTime ? formatDateTime(inTime) : 'Just Now'}
            </p>
            <span className="text-[10px] text-slate-400 block mt-1">
              ✓ Automatically recorded from device GPS geofence
            </span>
          </div>

          {/* Plant Location & Radius */}
          <div className="p-4 rounded-2xl bg-slate-800/60 border border-slate-700/60">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-400 mb-1.5">
              <MapPin className="w-4 h-4 text-emerald-400" />
              <span>Plant Location & Radius</span>
            </div>
            <p className="text-sm font-bold text-slate-200 truncate">
              {currentPlant?.location || 'Plant Coordinates'}
            </p>
            <span className="text-[11px] font-semibold text-emerald-400 block mt-1">
              Geofence Radius: {currentPlant?.radiusMeters || 500} meters
            </span>
          </div>
        </div>

        {/* Live Device Coordinates */}
        {lastLocation && (
          <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl bg-slate-950/60 border border-slate-800 text-xs text-slate-400">
            <div className="flex items-center gap-2">
              <Compass className="w-4 h-4 text-emerald-400" />
              <span>
                Coordinates: <strong className="text-white font-mono">{lastLocation.latitude.toFixed(5)}, {lastLocation.longitude.toFixed(5)}</strong>
              </span>
            </div>
            {lastLocation.accuracy && (
              <span className="text-[11px] text-slate-400">
                GPS Accuracy: ±{Math.round(lastLocation.accuracy)}m
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

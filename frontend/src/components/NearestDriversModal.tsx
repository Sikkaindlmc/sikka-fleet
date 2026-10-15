'use client';

import React, { useState } from 'react';
import Modal from './Modal';
import { User, Phone, Compass, CheckCircle2, ShieldCheck, RefreshCw, AlertCircle } from 'lucide-react';
import { formatDateTime } from '../lib/formatters';

export interface NearestDriverItem {
  id: string;
  driverId?: string;
  driverName: string;
  dlNumber?: string;
  mobileNumber: string;
  photo?: string | null;
  distanceMeters: number;
  radiusFromVehicleMeter?: number;
  lastLocationAt?: string | null;
}

interface NearestDriversModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  vehicleNumber?: string;
  vehicleId?: string;
  drivers: NearestDriverItem[];
  onSelectDriver?: (driver: NearestDriverItem) => Promise<void> | void;
  isAssigning?: boolean;
}

export default function NearestDriversModal({
  isOpen,
  onClose,
  title,
  subtitle = 'Drivers detected within their configured radius based on real-time device GPS coordinates',
  vehicleNumber,
  vehicleId,
  drivers = [],
  onSelectDriver,
  isAssigning = false,
}: NearestDriversModalProps) {
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);

  // Ensure nearest driver first (Section 4 requirement)
  const sortedDrivers = [...drivers].sort((a, b) => a.distanceMeters - b.distanceMeters);

  const handleAssignClick = async (driver: NearestDriverItem) => {
    if (!onSelectDriver) return;
    setAssignError(null);
    setSelectedDriverId(driver.id || driver.driverId || null);
    try {
      await onSelectDriver(driver);
    } catch (err: any) {
      setAssignError(err.message || 'Failed to assign driver to vehicle.');
    } finally {
      setSelectedDriverId(null);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} maxWidth="3xl" zIndex={90}>
      <div className="space-y-4">
        {/* Subtitle & Badge Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-3 border-b border-slate-100 text-xs">
          <div>
            <p className="text-slate-500 font-medium">{subtitle}</p>
            {vehicleNumber && (
              <p className="text-slate-800 font-bold text-xs mt-0.5">
                Target Vehicle: <span className="font-mono text-emerald-700 font-black">{vehicleNumber}</span>
              </p>
            )}
          </div>
          <span className="px-3 py-1 bg-emerald-100 text-emerald-900 border border-emerald-300 rounded-full font-black text-xs shrink-0 self-start sm:self-auto shadow-2xs">
            {sortedDrivers.length} {sortedDrivers.length === 1 ? 'Driver' : 'Drivers'} Found
          </span>
        </div>

        {/* Error notification if assignment fails */}
        {assignError && (
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>{assignError}</span>
          </div>
        )}

        {sortedDrivers.length === 0 ? (
          <div className="p-10 text-center text-slate-400 text-xs bg-slate-50 rounded-2xl border border-dashed border-slate-200">
            <User className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <p className="font-bold text-slate-700">No active drivers found within configured radius.</p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Drivers must have fresh GPS coordinates within their configured radius to be eligible.
            </p>
          </div>
        ) : (
          <>
            {/* Desktop Table View */}
            <div className="hidden sm:block overflow-x-auto rounded-2xl border border-slate-200 shadow-2xs">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                    <th className="px-4 py-3">Driver Photo</th>
                    <th className="px-4 py-3">Driver Name</th>
                    <th className="px-4 py-3">Mobile Number</th>
                    <th className="px-4 py-3 text-center">Distance</th>
                    <th className="px-4 py-3 text-center">Configured Radius</th>
                    {onSelectDriver && <th className="px-4 py-3 text-right">Action</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {sortedDrivers.map((d, index) => {
                    const isNearest = index === 0;
                    const isProcessing = isAssigning && selectedDriverId === (d.id || d.driverId);

                    return (
                      <tr
                        key={d.id || index}
                        className={`transition hover:bg-slate-50/80 ${
                          isNearest ? 'bg-emerald-50/20' : ''
                        }`}
                      >
                        {/* 1. Driver Photo (or default profile image) */}
                        <td className="px-4 py-3">
                          {d.photo ? (
                            <img
                              src={d.photo}
                              alt={d.driverName}
                              className="w-9 h-9 rounded-full object-cover border-2 border-emerald-500/40 shadow-xs bg-slate-100"
                            />
                          ) : (
                            <div className="w-9 h-9 rounded-full bg-slate-100 text-slate-600 font-bold flex items-center justify-center text-xs border border-slate-200 shadow-2xs">
                              {d.driverName ? d.driverName.charAt(0).toUpperCase() : <User className="w-4 h-4" />}
                            </div>
                          )}
                        </td>

                        {/* 2. Driver Name */}
                        <td className="px-4 py-3 font-bold text-slate-900">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span>{d.driverName}</span>
                            {isNearest && (
                              <span className="text-[9px] font-black uppercase tracking-wider bg-emerald-500 text-slate-950 px-1.5 py-0.2 rounded shadow-2xs">
                                Nearest
                              </span>
                            )}
                          </div>
                          {d.dlNumber && (
                            <span className="text-[10px] text-slate-400 font-mono block">
                              DL: {d.dlNumber}
                            </span>
                          )}
                        </td>

                        {/* 3. Mobile Number */}
                        <td className="px-4 py-3">
                          <a
                            href={`tel:${d.mobileNumber}`}
                            className="inline-flex items-center gap-1.5 text-slate-700 hover:text-emerald-700 font-mono font-medium transition"
                          >
                            <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <span>+91 {d.mobileNumber}</span>
                          </a>
                        </td>

                        {/* 4. Distance */}
                        <td className="px-4 py-3 text-center">
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 font-black text-xs font-mono shadow-2xs">
                            <Compass className="w-3 h-3 text-emerald-600 shrink-0" />
                            <span>{d.distanceMeters} m</span>
                          </span>
                        </td>

                        {/* 5. Configured Radius */}
                        <td className="px-4 py-3 text-center">
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-blue-50 border border-blue-200 text-blue-800 font-bold text-xs font-mono shadow-2xs">
                            <span>{d.radiusFromVehicleMeter ?? 100} Meters</span>
                          </span>
                        </td>

                        {/* Action: Manual Select/Assign */}
                        {onSelectDriver && (
                          <td className="px-4 py-3 text-right">
                            <button
                              type="button"
                              onClick={() => handleAssignClick(d)}
                              disabled={isAssigning}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-xs font-bold rounded-xl shadow-xs transition cursor-pointer disabled:opacity-50"
                              title={`Assign ${d.driverName} to this vehicle`}
                            >
                              {isProcessing ? (
                                <>
                                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                  <span>Assigning...</span>
                                </>
                              ) : (
                                <>
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  <span>Assign</span>
                                </>
                              )}
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Card View (Responsive Requirement) */}
            <div className="sm:hidden space-y-2.5 max-h-[60vh] overflow-y-auto">
              {sortedDrivers.map((d, index) => {
                const isNearest = index === 0;
                const isProcessing = isAssigning && selectedDriverId === (d.id || d.driverId);

                return (
                  <div
                    key={d.id || index}
                    className={`p-3.5 rounded-2xl border transition ${
                      isNearest ? 'bg-emerald-50/40 border-emerald-300' : 'bg-white border-slate-200'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {d.photo ? (
                        <img
                          src={d.photo}
                          alt={d.driverName}
                          className="w-11 h-11 rounded-full object-cover border-2 border-emerald-500/40 shadow-xs shrink-0 bg-slate-100"
                        />
                      ) : (
                        <div className="w-11 h-11 rounded-full bg-slate-100 text-slate-600 font-bold flex items-center justify-center text-sm border border-slate-200 shrink-0">
                          {d.driverName ? d.driverName.charAt(0).toUpperCase() : <User className="w-5 h-5" />}
                        </div>
                      )}

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1">
                          <h4 className="font-extrabold text-slate-900 text-sm truncate">
                            {d.driverName}
                          </h4>
                          {isNearest && (
                            <span className="text-[9px] font-black uppercase tracking-wider bg-emerald-500 text-slate-950 px-1.5 py-0.2 rounded shrink-0">
                              Nearest
                            </span>
                          )}
                        </div>

                        <a
                          href={`tel:${d.mobileNumber}`}
                          className="inline-flex items-center gap-1 text-xs text-slate-600 font-mono mt-0.5"
                        >
                          <Phone className="w-3 h-3 text-slate-400" />
                          <span>+91 {d.mobileNumber}</span>
                        </a>

                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 font-black text-xs font-mono">
                            <Compass className="w-3 h-3 text-emerald-600" />
                            <span>{d.distanceMeters} m away</span>
                          </span>

                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-50 border border-blue-200 text-blue-800 font-bold text-xs font-mono">
                            <span>Radius: {d.radiusFromVehicleMeter ?? 100}m</span>
                          </span>
                        </div>
                      </div>
                    </div>

                    {onSelectDriver && (
                      <div className="mt-3 pt-2.5 border-t border-slate-100 flex justify-end">
                        <button
                          type="button"
                          onClick={() => handleAssignClick(d)}
                          disabled={isAssigning}
                          className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-xs transition disabled:opacity-50"
                        >
                          {isProcessing ? (
                            <>
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              <span>Assigning...</span>
                            </>
                          ) : (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Assign to Vehicle</span>
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Footer with Close Button */}
        <div className="flex items-center justify-between pt-3 border-t border-slate-100">
          <span className="text-[11px] text-slate-400 font-medium">
            GPS proximity refreshed every 30 minutes
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-700 text-xs font-bold rounded-xl transition cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}

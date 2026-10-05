'use client';

import React from 'react';
import Modal from './Modal';
import { User, Phone, Compass, MapPin, CheckCircle2 } from 'lucide-react';
import { formatDateTime } from '../lib/formatters';

export interface NearestDriverItem {
  id: string;
  driverName: string;
  dlNumber: string;
  mobileNumber: string;
  distanceMeters: number;
  lastLocationAt?: string | null;
}

interface NearestDriversModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  drivers: NearestDriverItem[];
}

export default function NearestDriversModal({
  isOpen,
  onClose,
  title,
  subtitle = 'Drivers detected within 100m radius based on real-time device GPS coordinates',
  drivers,
}: NearestDriversModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} maxWidth="2xl">
      <div className="space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-slate-100 text-xs">
          <p className="text-slate-500 font-medium">
            {subtitle}
          </p>
          <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 rounded-full font-bold text-[11px] shrink-0">
            {drivers.length} Drivers Found
          </span>
        </div>

        {drivers.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-xs">
            No active drivers located within 100 meters.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                  <th className="px-4 py-3">Driver Name</th>
                  <th className="px-4 py-3">DL Number</th>
                  <th className="px-4 py-3">Mobile Number</th>
                  <th className="px-4 py-3 text-right">GPS Distance</th>
                  <th className="px-4 py-3 text-right">Last GPS Update</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {drivers.map((d, index) => (
                  <tr key={d.id || index} className="hover:bg-slate-50/80 transition">
                    <td className="px-4 py-3 font-bold text-slate-900">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold text-xs">
                          {d.driverName ? d.driverName.charAt(0).toUpperCase() : 'D'}
                        </div>
                        <span>{d.driverName}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-600">
                      {d.dlNumber || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <a
                        href={`tel:${d.mobileNumber}`}
                        className="inline-flex items-center gap-1.5 text-slate-700 hover:text-emerald-700 font-mono font-medium transition"
                      >
                        <Phone className="w-3.5 h-3.5 text-slate-400" />
                        <span>+91 {d.mobileNumber}</span>
                      </a>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 font-bold text-xs font-mono">
                        <Compass className="w-3 h-3 text-emerald-600" />
                        <span>{d.distanceMeters} m</span>
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-slate-400 text-[11px]">
                      {d.lastLocationAt ? formatDateTime(d.lastLocationAt) : 'Recently'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}

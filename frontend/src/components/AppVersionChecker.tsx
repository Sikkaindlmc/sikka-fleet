'use client';

import React, { useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';
import { Download, AlertTriangle, X } from 'lucide-react';

interface VersionInfo {
  latestVersion: string;
  minimumSupportedVersion: string;
  mandatoryUpdate: boolean;
  iosAppStoreUrl?: string;
  androidPlayStoreUrl?: string;
  releaseNotes?: string;
}

const CURRENT_APP_VERSION = '1.0.0';

export default function AppVersionChecker() {
  const [updateInfo, setUpdateInfo] = useState<VersionInfo | null>(null);
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    // Only check version inside browser/mobile client
    if (typeof window === 'undefined') return;

    let isMounted = true;

    async function checkVersion() {
      try {
        const info = await apiRequest<VersionInfo>('/app/version', {
          timeoutMs: 8000,
        });

        if (!isMounted || !info) return;

        // Compare semantic versions (e.g., '1.0.0' vs '1.0.1')
        const currentParts = CURRENT_APP_VERSION.split('.').map(Number);
        const minParts = (info.minimumSupportedVersion || '1.0.0').split('.').map(Number);
        const latestParts = (info.latestVersion || '1.0.0').split('.').map(Number);

        const isBelowMinimum =
          currentParts[0] < minParts[0] ||
          (currentParts[0] === minParts[0] && currentParts[1] < minParts[1]) ||
          (currentParts[0] === minParts[0] && currentParts[1] === minParts[1] && currentParts[2] < minParts[2]);

        const isOutdated =
          currentParts[0] < latestParts[0] ||
          (currentParts[0] === latestParts[0] && currentParts[1] < latestParts[1]) ||
          (currentParts[0] === latestParts[0] && currentParts[1] === latestParts[1] && currentParts[2] < latestParts[2]);

        if (info.mandatoryUpdate || isBelowMinimum) {
          setUpdateInfo({ ...info, mandatoryUpdate: true });
        } else if (isOutdated) {
          setUpdateInfo({ ...info, mandatoryUpdate: false });
        }
      } catch {
        // Silently ignore network failures during background update checks
      }
    }

    checkVersion();

    return () => {
      isMounted = false;
    };
  }, []);

  if (!updateInfo || (isDismissed && !updateInfo.mandatoryUpdate)) {
    return null;
  }

  const isIos =
    typeof navigator !== 'undefined' &&
    (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

  const updateUrl = isIos
    ? updateInfo.iosAppStoreUrl || 'https://apps.apple.com'
    : updateInfo.androidPlayStoreUrl || 'https://play.google.com';

  const handleUpdateClick = () => {
    if (typeof window !== 'undefined') {
      window.open(updateUrl, '_blank');
    }
  };

  // Mandatory Update Blocking Modal
  if (updateInfo.mandatoryUpdate) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4">
        <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 text-center animate-in fade-in zoom-in-95 duration-200">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 mb-4 border border-amber-200">
            <AlertTriangle className="h-7 w-7" />
          </div>
          <h3 className="text-lg font-bold text-slate-900 mb-1">Update Required</h3>
          <p className="text-xs text-slate-600 mb-4">
            A critical update (v{updateInfo.latestVersion}) is required to continue using Sikka Fleet.
          </p>
          {updateInfo.releaseNotes && (
            <div className="rounded-xl bg-slate-50 p-3 text-left text-[11px] text-slate-600 border border-slate-100 mb-5 max-h-24 overflow-y-auto">
              <span className="font-semibold block text-slate-700 mb-0.5">What's New:</span>
              {updateInfo.releaseNotes}
            </div>
          )}
          <button
            type="button"
            onClick={handleUpdateClick}
            className="w-full py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs transition flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/25"
          >
            <Download className="h-4 w-4" />
            Update from {isIos ? 'App Store' : 'Play Store'}
          </button>
        </div>
      </div>
    );
  }

  // Optional Update Non-Blocking Toast
  return (
    <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-6 md:w-96 z-40 animate-in slide-in-from-bottom-4 duration-300">
      <div className="rounded-2xl bg-slate-900 text-white p-4 shadow-xl border border-slate-800 flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400 mb-1">
            <Download className="h-3.5 w-3.5" />
            Update Available (v{updateInfo.latestVersion})
          </div>
          <p className="text-[11px] text-slate-300 mb-2">
            A newer version of Sikka Fleet is available for iPhone and Android.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleUpdateClick}
              className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-[11px] transition"
            >
              Update Now
            </button>
            <button
              type="button"
              onClick={() => setIsDismissed(true)}
              className="px-2 py-1.5 text-[11px] text-slate-400 hover:text-white"
            >
              Later
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setIsDismissed(true)}
          className="text-slate-400 hover:text-white p-1"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

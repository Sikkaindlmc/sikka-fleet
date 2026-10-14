'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { apiRequest } from '../lib/api';
import { Download, AlertTriangle, X, RefreshCw, WifiOff, CheckCircle2, Sparkles } from 'lucide-react';

interface VersionInfo {
  latestVersion: string;
  webVersion?: string;
  webBuildId?: string;
  minimumSupportedVersion: string;
  nativeAndroidVersionCode?: number;
  latestAndroidVersionCode?: number;
  minSupportedAndroidVersionCode?: number;
  mandatoryNativeUpdate?: boolean;
  mandatoryUpdate?: boolean;
  apkDownloadUrl?: string;
  androidPlayStoreUrl?: string;
  iosAppStoreUrl?: string;
  releaseNotes?: string;
  features?: string[];
}

// Current bundled version constants
export const CURRENT_WEB_VERSION = '1.0.1';
export const CURRENT_WEB_BUILD_ID = '20261013-02';
export const CURRENT_NATIVE_ANDROID_VERSION_CODE = 1;

export default function AppVersionChecker() {
  const [nativeUpdateInfo, setNativeUpdateInfo] = useState<VersionInfo | null>(null);
  const [webUpdateAvailable, setWebUpdateAvailable] = useState<VersionInfo | null>(null);
  const [isDismissed, setIsDismissed] = useState(false);
  const [isWebUpdateDismissed, setIsWebUpdateDismissed] = useState(false);
  const [isRefreshingWeb, setIsRefreshingWeb] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const lastCheckTimeRef = useRef<number>(0);

  // Helper to determine if user is currently busy typing in an input or modal form
  const isUserBusy = useCallback(() => {
    if (typeof document === 'undefined') return false;
    const active = document.activeElement;
    if (!active) return false;
    const tag = active.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (active.getAttribute('contenteditable') === 'true') return true;
    return false;
  }, []);

  // Check version and updates from backend
  const checkVersion = useCallback(async () => {
    if (typeof window === 'undefined') return;

    // Rate limit checks: at most once every 60 seconds
    const now = Date.now();
    if (now - lastCheckTimeRef.current < 60000) return;
    lastCheckTimeRef.current = now;

    try {
      const info = await apiRequest<VersionInfo>('/app/version', {
        timeoutMs: 8000,
      });

      if (!info) return;

      // 1. Check Native Android / iOS APK Update
      const latestNativeCode = info.latestAndroidVersionCode || 1;
      const minNativeCode = info.minSupportedAndroidVersionCode || 1;
      const isNativeBelowMin = CURRENT_NATIVE_ANDROID_VERSION_CODE < minNativeCode;
      const isNativeOutdated = CURRENT_NATIVE_ANDROID_VERSION_CODE < latestNativeCode;

      if (info.mandatoryNativeUpdate || isNativeBelowMin) {
        setNativeUpdateInfo({ ...info, mandatoryUpdate: true });
      } else if (isNativeOutdated) {
        setNativeUpdateInfo({ ...info, mandatoryUpdate: false });
      }

      // 2. Check Automatic Web Application Update
      const remoteBuildId = info.webBuildId || info.webVersion;
      if (remoteBuildId && remoteBuildId !== CURRENT_WEB_BUILD_ID && remoteBuildId !== CURRENT_WEB_VERSION) {
        setWebUpdateAvailable(info);
      }
    } catch {
      // Silently ignore network failures during background update checks
    }
  }, []);

  // Handle Online / Offline detection
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOnline = () => {
      setIsOffline(false);
      checkVersion();
    };

    const handleOffline = () => {
      setIsOffline(true);
    };

    setIsOffline(!navigator.onLine);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [checkVersion]);

  // Initial check, visibility listener (app resume), and periodic timer
  useEffect(() => {
    if (typeof window === 'undefined') return;

    checkVersion();

    // Check when user switches back to the app / tab
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkVersion();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Periodic check every 10 minutes
    const interval = setInterval(() => {
      checkVersion();
    }, 10 * 60 * 1000);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearInterval(interval);
    };
  }, [checkVersion]);

  // Perform seamless web application update
  const handleApplyWebUpdate = () => {
    if (typeof window === 'undefined') return;
    setIsRefreshingWeb(true);

    // Prevent reload loop by storing timestamp in sessionStorage
    sessionStorage.setItem('sikka_last_web_reload', String(Date.now()));

    // Safe cache-busting reload
    setTimeout(() => {
      window.location.reload();
    }, 300);
  };

  const isIos =
    typeof navigator !== 'undefined' &&
    (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

  const nativeUpdateUrl = isIos
    ? nativeUpdateInfo?.iosAppStoreUrl || 'https://apps.apple.com'
    : nativeUpdateInfo?.apkDownloadUrl || nativeUpdateInfo?.androidPlayStoreUrl || 'https://sikka-fleet.vercel.app/SikkaFleet.apk';

  const handleNativeUpdateClick = () => {
    if (typeof window !== 'undefined') {
      window.open(nativeUpdateUrl, '_blank');
    }
  };

  return (
    <>
      {/* 1. Offline Mode Indicator */}
      {isOffline && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-amber-600 text-white text-xs font-semibold py-1.5 px-4 text-center shadow-md flex items-center justify-center gap-2">
          <WifiOff className="w-3.5 h-3.5" />
          <span>Offline Mode — Showing local cached data. Telemetry will sync when connection returns.</span>
        </div>
      )}

      {/* 2. Web Application Auto-Update Banner (Single Source of Truth) */}
      {webUpdateAvailable && !isWebUpdateDismissed && !isRefreshingWeb && (
        <aside
          role="region"
          aria-label="Application Update Notice"
          className="fixed bottom-4 left-4 right-4 md:left-auto md:right-6 md:w-96 z-50 animate-in slide-in-from-bottom-4 duration-300 pointer-events-auto"
        >
          <div className="rounded-2xl bg-slate-900/95 backdrop-blur-md text-white p-4 shadow-2xl border border-emerald-500/30 flex items-start justify-between gap-3">
            <div className="flex-1">
              <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-400 mb-1">
                <Sparkles className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Web Application Updated</span>
              </div>
              <p className="text-[11px] text-slate-300 leading-relaxed mb-2.5">
                New features and UI improvements are available from the production server. Tap to refresh.
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleApplyWebUpdate}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 text-slate-950 font-bold text-xs transition cursor-pointer shadow-xs"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Update Now</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsWebUpdateDismissed(true)}
                  className="px-2.5 py-1.5 text-[11px] font-medium text-slate-400 hover:text-white transition cursor-pointer"
                >
                  Later
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsWebUpdateDismissed(true)}
              className="text-slate-400 hover:text-white p-1 rounded-lg transition cursor-pointer"
              aria-label="Dismiss update notification"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </aside>
      )}

      {/* 3. Updating Loader Overlay */}
      {isRefreshingWeb && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="rounded-2xl bg-white p-6 text-center max-w-xs w-full shadow-2xl">
            <RefreshCw className="w-8 h-8 text-emerald-600 animate-spin mx-auto mb-3" />
            <h4 className="text-sm font-bold text-slate-900 mb-1">Updating Sikka Fleet</h4>
            <p className="text-xs text-slate-500">Loading latest production features...</p>
          </div>
        </div>
      )}

      {/* 4. Mandatory Native APK / Store Update Blocking Modal */}
      {nativeUpdateInfo && nativeUpdateInfo.mandatoryUpdate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 text-center animate-in fade-in zoom-in-95 duration-200">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 mb-4 border border-amber-200">
              <AlertTriangle className="h-7 w-7" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 mb-1">Native App Update Required</h3>
            <p className="text-xs text-slate-600 mb-4">
              A newer Android application package (v{nativeUpdateInfo.latestVersion}) is required for device permissions and background location services.
            </p>
            {nativeUpdateInfo.releaseNotes && (
              <div className="rounded-xl bg-slate-50 p-3 text-left text-[11px] text-slate-600 border border-slate-100 mb-5 max-h-24 overflow-y-auto">
                <span className="font-semibold block text-slate-700 mb-0.5">What&apos;s New:</span>
                {nativeUpdateInfo.releaseNotes}
              </div>
            )}
            <button
              type="button"
              onClick={handleNativeUpdateClick}
              className="w-full py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs transition flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/25 cursor-pointer"
            >
              <Download className="h-4 w-4" />
              <span>Download &amp; Install Updated APK</span>
            </button>
          </div>
        </div>
      )}

      {/* 5. Optional Native APK Update Non-Blocking Toast */}
      {nativeUpdateInfo && !nativeUpdateInfo.mandatoryUpdate && !isDismissed && (
        <aside
          role="region"
          aria-label="Native Android Update Notice"
          className="fixed bottom-20 left-4 right-4 md:left-auto md:right-6 md:w-96 z-40 animate-in slide-in-from-bottom-4 duration-300 pointer-events-auto"
        >
          <div className="rounded-2xl bg-slate-900 text-white p-4 shadow-xl border border-slate-800 flex items-start justify-between gap-3">
            <div className="flex-1">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400 mb-1">
                <Download className="h-3.5 w-3.5" />
                <span>Native Update Available (v{nativeUpdateInfo.latestVersion})</span>
              </div>
              <p className="text-[11px] text-slate-300 mb-2">
                A new signed Android APK release is available for download.
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleNativeUpdateClick}
                  className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-[11px] transition cursor-pointer"
                >
                  Download APK
                </button>
                <button
                  type="button"
                  onClick={() => setIsDismissed(true)}
                  className="px-2 py-1.5 text-[11px] text-slate-400 hover:text-white cursor-pointer"
                >
                  Later
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsDismissed(true)}
              className="text-slate-400 hover:text-white p-1 cursor-pointer"
              aria-label="Dismiss notification"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </aside>
      )}
    </>
  );
}

'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const DISMISSED_KEY = 'sikka_pwa_dismissed_until';
const INSTALLED_KEY = 'sikka_pwa_installed';
const INSTALL_STATE_EVENT = 'sikka:pwa-install-state';
const DISMISS_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIosDevice(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

function isIosInAppBrowser(): boolean {
  return /CriOS|FxiOS|EdgiOS|OPiOS|WhatsApp|FBAN|FBAV|Instagram/i.test(navigator.userAgent);
}

function shouldShowInstallPrompt(): boolean {
  if (typeof window === 'undefined' || isStandalone()) return false;
  if (localStorage.getItem(INSTALLED_KEY)) return false;
  if (Number(localStorage.getItem(DISMISSED_KEY) || '0') > Date.now()) return false;

  return (
    isIosDevice() ||
    /Android/i.test(navigator.userAgent) ||
    (window.matchMedia('(pointer: coarse)').matches && window.innerWidth < 900)
  );
}

function subscribeToInstallState(onChange: () => void): () => void {
  const media = window.matchMedia('(display-mode: standalone)');
  let dismissalTimer: number | undefined;
  const notify = () => {
    if (dismissalTimer !== undefined) window.clearTimeout(dismissalTimer);
    onChange();
    const dismissedUntil = Number(localStorage.getItem(DISMISSED_KEY) || '0');
    const remaining = dismissedUntil - Date.now();
    if (remaining > 0) {
      dismissalTimer = window.setTimeout(notify, remaining + 1);
    }
  };
  window.addEventListener('resize', notify);
  window.addEventListener('storage', notify);
  window.addEventListener(INSTALL_STATE_EVENT, notify);
  window.addEventListener('appinstalled', notify);
  media.addEventListener('change', notify);
  const dismissedUntil = Number(localStorage.getItem(DISMISSED_KEY) || '0');
  if (dismissedUntil > Date.now()) {
    dismissalTimer = window.setTimeout(notify, dismissedUntil - Date.now() + 1);
  }
  return () => {
    window.removeEventListener('resize', notify);
    window.removeEventListener('storage', notify);
    window.removeEventListener(INSTALL_STATE_EVENT, notify);
    window.removeEventListener('appinstalled', notify);
    media.removeEventListener('change', notify);
    if (dismissalTimer !== undefined) window.clearTimeout(dismissalTimer);
  };
}

export default function InstallPrompt() {
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);
  const [manualInstallHelp, setManualInstallHelp] = useState(false);
  const visible = useSyncExternalStore(
    subscribeToInstallState,
    shouldShowInstallPrompt,
    () => false
  );
  const ios = typeof navigator !== 'undefined' && isIosDevice();
  const iosInApp = ios && isIosInAppBrowser();

  useEffect(() => {
    // Install the worker in production only; it caches the shell and static assets, never API data.
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      void navigator.serviceWorker.register('/service-worker.js', { scope: '/' }).catch((error) => {
        console.error('[PWA] Service worker registration failed.', error);
      });
    }

    const standalone = isStandalone();
    if (standalone) {
      localStorage.setItem(INSTALLED_KEY, '1');
      window.dispatchEvent(new Event(INSTALL_STATE_EVENT));
    }

    const handleBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as InstallPromptEvent);
    };
    const handleInstalled = () => {
      localStorage.setItem(INSTALLED_KEY, '1');
      window.dispatchEvent(new Event(INSTALL_STATE_EVENT));
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  const dismiss = () => {
    localStorage.setItem(DISMISSED_KEY, String(Date.now() + DISMISS_PERIOD_MS));
    window.dispatchEvent(new Event(INSTALL_STATE_EVENT));
  };

  const install = async () => {
    if (!installEvent) {
      setManualInstallHelp(true);
      return;
    }

    try {
      await installEvent.prompt();
      const choice = await installEvent.userChoice;
      setInstallEvent(null);
      if (choice.outcome === 'dismissed') dismiss();
    } catch (error) {
      console.error('[PWA] Browser install prompt failed.', error);
      setInstallEvent(null);
      setManualInstallHelp(true);
    }
  };

  if (!visible || isStandalone()) return null;

  return (
    <aside
      role="region"
      aria-label="Install Sikka Fleet"
      className="fixed bottom-4 left-4 right-4 z-[60] mx-auto max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-4 text-white shadow-2xl"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold">Install Sikka Fleet app</p>
          {ios ? (
            <p className="mt-1 text-xs leading-relaxed text-slate-300">
              {iosInApp
                ? 'Open this link in Safari, then tap Share and choose “Add to Home Screen”.'
                : 'Tap the Share button, then “Add to Home Screen”.'}
            </p>
          ) : manualInstallHelp ? (
            <p className="mt-1 text-xs leading-relaxed text-slate-300">
              Open your browser menu and choose “Install app” or “Add to Home screen”.
            </p>
          ) : (
            <p className="mt-1 text-xs leading-relaxed text-slate-300">
              Add the app to your home screen for quicker access.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss install prompt"
          className="rounded-lg p-1 text-slate-300 hover:bg-slate-800 hover:text-white"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
      {!ios && (
        <button
          type="button"
          onClick={() => void install()}
          className="mt-3 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400"
        >
          Install
        </button>
      )}
    </aside>
  );
}

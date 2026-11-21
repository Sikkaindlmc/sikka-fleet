'use client';

import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, RotateCcw, Save, Server } from 'lucide-react';
import AppLayout from '../../../components/AppLayout';
import { apiRequest, BACKUP_CLOUD_API_URL, getApiBaseUrl, PRODUCTION_API_URL } from '../../../lib/api';

export default function ServerSettingsPage() {
  const [serverUrl, setServerUrl] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [authorized, setAuthorized] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState(true);

  useEffect(() => {
    apiRequest<{ user: { role?: string } }>('/auth/me')
      .then(({ user }) => {
        if (user?.role !== 'Admin') {
          setError('Administrator access is required.');
          return;
        }
        setAuthorized(true);
        setServerUrl(getApiBaseUrl());
      })
      .catch(() => setError('Administrator access could not be verified. Sign in again and retry.'))
      .finally(() => setCheckingAccess(false));
  }, []);

  const save = () => {
    setError('');
    setMessage('');
    let parsed: URL;
    try {
      parsed = new URL(serverUrl.trim());
    } catch {
      setError('Enter a valid server URL.');
      return;
    }

    const isLocalHttp = parsed.protocol === 'http:' &&
      ['localhost', '127.0.0.1'].includes(parsed.hostname);
    if (parsed.protocol !== 'https:' && !isLocalHttp) {
      setError('Use HTTPS for remote servers. HTTP is allowed only for localhost development.');
      return;
    }

    const normalized = parsed.toString().replace(/\/+$/, '');
    localStorage.setItem('sikka_fleet_server_url', normalized);
    setServerUrl(normalized);
    setMessage('Server URL saved for this browser.');
  };

  const reset = () => {
    localStorage.removeItem('sikka_fleet_server_url');
    setServerUrl(getApiBaseUrl());
    setMessage('Default server URL restored for this browser.');
    setError('');
  };

  return (
    <AppLayout pageTitle="Server Settings" requiredRole="Admin">
      {checkingAccess ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-600">
          Verifying administrator access…
        </div>
      ) : authorized ? (
        <section className="max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-5 flex items-center gap-3">
            <div className="rounded-xl bg-emerald-50 p-3 text-emerald-700">
              <Server className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900">Backend connection</h1>
              <p className="text-sm text-slate-500">This setting is stored only in this browser.</p>
            </div>
          </div>

          <label htmlFor="server-url" className="mb-2 block text-sm font-semibold text-slate-700">
            Server URL
          </label>
          <input
            id="server-url"
            type="url"
            autoComplete="url"
            value={serverUrl}
            onChange={(event) => setServerUrl(event.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 font-mono text-sm text-slate-800 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
          />

          <div className="mt-3 flex flex-wrap gap-2">
            {[PRODUCTION_API_URL, BACKUP_CLOUD_API_URL].map((url) => (
              <button
                key={url}
                type="button"
                onClick={() => setServerUrl(url)}
                className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                {url === PRODUCTION_API_URL ? 'Official server' : 'Backup server'}
              </button>
            ))}
          </div>

          {error && (
            <p role="alert" className="mt-4 flex items-center gap-2 text-sm text-rose-700">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </p>
          )}
          {message && (
            <p role="status" className="mt-4 flex items-center gap-2 text-sm text-emerald-700">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              {message}
            </p>
          )}

          <div className="mt-5 flex gap-3">
            <button
              type="button"
              onClick={save}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-700"
            >
              <Save className="h-4 w-4" />
              Save URL
            </button>
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <RotateCcw className="h-4 w-4" />
              Reset default
            </button>
          </div>
        </section>
      ) : (
        <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800">
          {error}
        </div>
      )}
    </AppLayout>
  );
}

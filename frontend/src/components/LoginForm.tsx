'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Eye,
  EyeOff,
  Lock,
  User as UserIcon,
  AlertCircle,
  ArrowRight,
  ShieldCheck,
  Truck,
  MapPin,
  Navigation,
  Settings,
} from 'lucide-react';
import { useAuth } from '../lib/authContext';
import { getApiBaseUrl, PRODUCTION_API_URL, BACKUP_CLOUD_API_URL, CLOUD_API_URL, isPrivateOrLanUrl } from '../lib/api';

interface LoginFormProps {
  redirectUrl?: string;
  sessionExpiredNotice?: boolean;
}

export default function LoginForm({
  redirectUrl = '/dashboard',
  sessionExpiredNotice = false,
}: LoginFormProps) {
  const [loginType, setLoginType] = useState<'User' | 'Driver'>('User');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [showServerSettings, setShowServerSettings] = useState(false);
  const [serverUrlInput, setServerUrlInput] = useState('');

  const { login } = useAuth();
  const router = useRouter();
  const usernameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('sikka_fleet_server_url') || '';
      if (isPrivateOrLanUrl(stored)) {
        localStorage.setItem('sikka_fleet_server_url', CLOUD_API_URL);
        setServerUrlInput(CLOUD_API_URL);
      } else {
        setServerUrlInput(stored || getApiBaseUrl());
      }
    }
  }, []);

  const handleSaveServerUrl = () => {
    if (typeof window !== 'undefined') {
      const trimmed = serverUrlInput.trim().replace(/\/+$/, '');
      if (trimmed && !isPrivateOrLanUrl(trimmed)) {
        localStorage.setItem('sikka_fleet_server_url', trimmed);
        setServerUrlInput(trimmed);
      } else {
        localStorage.setItem('sikka_fleet_server_url', PRODUCTION_API_URL);
        setServerUrlInput(PRODUCTION_API_URL);
      }
      setShowServerSettings(false);
    }
  };

  const handleResetServerUrl = () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('sikka_fleet_server_url');
      setServerUrlInput(PRODUCTION_API_URL);
      setShowServerSettings(false);
    }
  };

  const handleSelectPreset = (url: string) => {
    if (typeof window !== 'undefined') {
      setServerUrlInput(url);
      localStorage.setItem('sikka_fleet_server_url', url);
    }
  };

  // Auto-focus username field once form is ready
  useEffect(() => {
    usernameInputRef.current?.focus();
  }, [loginType]);

  // Request browser device location (with fallback so driver is never blocked)
  const getDeviceLocation = (): Promise<{ latitude: number; longitude: number; accuracy: number } | null> => {
    return new Promise((resolve) => {
      if (typeof window === 'undefined' || !('geolocation' in navigator)) {
        return resolve(null);
      }

      // First try: High accuracy GPS with 4-second timeout
      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
          });
        },
        () => {
          // Second try fallback: Standard network location with 3-second timeout
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              resolve({
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
                accuracy: pos.coords.accuracy,
              });
            },
            () => {
              // Gracefully resolve null so login succeeds even if GPS is off
              resolve(null);
            },
            {
              enableHighAccuracy: false,
              timeout: 3000,
              maximumAge: 60000,
            }
          );
        },
        {
          enableHighAccuracy: true,
          timeout: 4000,
          maximumAge: 0,
        }
      );
    });
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    if (!username.trim()) {
      setErrorMessage(
        loginType === 'Driver'
          ? 'Please enter your Driver DL Number.'
          : 'Please enter your username.'
      );
      return;
    }
    if (!password) {
      setErrorMessage(
        loginType === 'Driver'
          ? 'Please enter your registered 10-digit mobile number.'
          : 'Please enter your password.'
      );
      return;
    }

    setIsLoading(true);

    let locationData: { latitude: number; longitude: number; accuracy: number } | undefined = undefined;

    // Capture device location for Driver telematics
    if (loginType === 'Driver') {
      setIsLocating(true);
      try {
        const loc = await getDeviceLocation();
        if (loc) {
          locationData = loc;
        }
      } catch {
        // Location will be updated in background by dashboard
      } finally {
        setIsLocating(false);
      }
    }

    try {
      await login(username.trim(), password, loginType, locationData);
      router.push(redirectUrl);
    } catch (err: any) {
      setErrorMessage(
        err.message || 'Invalid credentials. Please verify your details and try again.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl border border-slate-100 p-8 sm:p-10 relative backdrop-blur-xl">
      {/* Session Expired Notice */}
      {sessionExpiredNotice && (
        <div className="mb-6 p-3.5 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-3 text-amber-800 text-xs">
          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <span>Your session has expired. Please sign in again to continue.</span>
        </div>
      )}

      {/* Header */}
      <div className="text-left mb-6">
        <h2 className="text-2xl font-black text-slate-900 tracking-tight">
          Sign in to your account
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          {loginType === 'Driver'
            ? 'Enter your DL number and mobile number to access your telematics dashboard'
            : 'Enter your credentials to access the fleet management dashboard'}
        </p>
      </div>

      {/* Error Alert */}
      {errorMessage && (
        <div className="mb-6 p-4 bg-rose-50 border border-rose-200/80 rounded-2xl flex items-start gap-3 text-rose-700 text-xs leading-relaxed animate-in fade-in duration-200">
          <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
          <div className="flex-1">{errorMessage}</div>
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleLogin} className="space-y-4">
        {/* Login Type Selector */}
        <div>
          <label className="block text-[11px] font-extrabold uppercase tracking-wider text-slate-500 mb-2">
            Login Type
          </label>
          <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-2xl">
            <button
              type="button"
              onClick={() => {
                setLoginType('User');
                setErrorMessage('');
              }}
              className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                loginType === 'User'
                  ? 'bg-white text-slate-900 shadow-sm border border-slate-200/60'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>User</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setLoginType('Driver');
                setErrorMessage('');
              }}
              className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                loginType === 'Driver'
                  ? 'bg-white text-slate-900 shadow-sm border border-slate-200/60'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Truck className="w-4 h-4 text-emerald-600" />
              <span>Driver</span>
            </button>
          </div>
        </div>

        {/* Username / DL Number Field */}
        <div>
          <label
            htmlFor="username"
            className="block text-[11px] font-extrabold uppercase tracking-wider text-slate-500 mb-1.5"
          >
            {loginType === 'Driver' ? 'DL Number (Driving License)' : 'Username'}
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
              <UserIcon className="w-4 h-4" />
            </div>
            <input
              id="username"
              ref={usernameInputRef}
              type="text"
              required
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder=""
              className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-semibold text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition"
            />
          </div>
        </div>

        {/* Password / Mobile Number Field */}
        <div>
          <label
            htmlFor="password"
            className="block text-[11px] font-extrabold uppercase tracking-wider text-slate-500 mb-1.5"
          >
            {loginType === 'Driver' ? 'Registered Mobile Number' : 'Password'}
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
              <Lock className="w-4 h-4" />
            </div>
            <input
              id="password"
              type={loginType === 'Driver' ? 'tel' : showPassword ? 'text' : 'password'}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={loginType === 'Driver' ? '10-digit mobile number' : '••••••••••••'}
              maxLength={loginType === 'Driver' ? 10 : undefined}
              className="w-full pl-10 pr-11 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-semibold text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition"
            />
            {loginType !== 'Driver' && (
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer"
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            )}
          </div>
        </div>

        {/* Location Notice for Drivers */}
        {loginType === 'Driver' && (
          <div className="p-3 bg-emerald-50/70 border border-emerald-200/80 rounded-2xl flex items-start gap-2.5 text-[11px] text-emerald-900 leading-relaxed">
            <Navigation className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <span>
              Device location access will be requested automatically to determine your active plant presence.
            </span>
          </div>
        )}

        {/* Submit Button */}
        <div className="pt-2">
          <button
            type="submit"
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-2 py-3.5 px-4 bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 text-slate-950 text-xs font-black tracking-wide uppercase rounded-2xl shadow-lg shadow-emerald-500/25 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span>
              {isLocating
                ? 'Requesting Device Location...'
                : isLoading
                ? 'Signing in...'
                : `Sign In as ${loginType}`}
            </span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>

        {/* Mobile Server Connection Settings */}
        <div className="pt-3 border-t border-slate-100 text-center">
          <button
            type="button"
            onClick={() => setShowServerSettings(!showServerSettings)}
            className="text-[11px] font-semibold text-slate-400 hover:text-emerald-600 transition inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Settings className="w-3.5 h-3.5" />
            <span>{showServerSettings ? 'Hide Server Settings' : 'Configure Server URL (Mobile)'}</span>
          </button>

          {showServerSettings && (
            <div className="mt-2.5 p-3.5 bg-slate-50 border border-slate-200/90 rounded-2xl text-left text-xs space-y-2.5 animate-in fade-in duration-150">
              <div className="flex items-center justify-between">
                <label className="block text-[11px] font-bold text-slate-700">
                  Backend Server API URL:
                </label>
                <span className="text-[10px] text-emerald-600 font-bold bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                  Cloud HTTPS Active
                </span>
              </div>
              <input
                type="url"
                value={serverUrlInput}
                onChange={(e) => setServerUrlInput(e.target.value)}
                placeholder="https://fleet.sikkaind.com/api"
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <div className="pt-0.5 space-y-1.5">
                <button
                  type="button"
                  onClick={() => handleSelectPreset(PRODUCTION_API_URL)}
                  className={`w-full py-1.5 px-2 rounded-xl text-[10px] font-bold border transition text-left ${
                    serverUrlInput === PRODUCTION_API_URL
                      ? 'bg-emerald-50 border-emerald-400 text-emerald-800'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  🌐 Official Domain (fleet.sikkaind.com)
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectPreset(BACKUP_CLOUD_API_URL)}
                  className={`w-full py-1.5 px-2 rounded-xl text-[10px] font-semibold border transition text-left truncate ${
                    serverUrlInput === BACKUP_CLOUD_API_URL
                      ? 'bg-emerald-50 border-emerald-400 text-emerald-800'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  ☁️ Backup Cloud (sikka-fleet.vercel.app)
                </button>
              </div>
              <div className="flex items-center justify-between pt-1 border-t border-slate-200/60">
                <button
                  type="button"
                  onClick={handleSaveServerUrl}
                  className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold rounded-xl text-[11px] cursor-pointer shadow-xs"
                >
                  Save URL
                </button>
                <button
                  type="button"
                  onClick={handleResetServerUrl}
                  className="text-[11px] font-medium text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  Reset Default
                </button>
              </div>
            </div>
          )}
        </div>
      </form>
    </div>
  );
}

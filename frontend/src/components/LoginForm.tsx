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
} from 'lucide-react';
import { useAuth } from '../lib/authContext';

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

  const { login } = useAuth();
  const router = useRouter();
  const usernameInputRef = useRef<HTMLInputElement>(null);

  // Auto-focus username field once form is ready
  useEffect(() => {
    usernameInputRef.current?.focus();
  }, [loginType]);

  // Request browser device location (mandatory for Driver login)
  const getDeviceLocation = (): Promise<{ latitude: number; longitude: number; accuracy: number }> => {
    return new Promise((resolve, reject) => {
      if (!('geolocation' in navigator)) {
        return reject(new Error('Geolocation is not supported by your browser.'));
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
          });
        },
        (error) => {
          reject(error);
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
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

    // Mandatory device location access for Driver login (Requirement 14 & 16)
    if (loginType === 'Driver') {
      setIsLocating(true);
      try {
        locationData = await getDeviceLocation();
      } catch (locErr: any) {
        setIsLoading(false);
        setIsLocating(false);

        let guidance = 'Please allow location permission in your browser/device to log in as a Driver.';
        if (locErr.code === 1) {
          guidance = 'Location permission was denied. Please click the site settings/lock icon in your browser URL bar and allow Location access.';
        } else if (locErr.code === 2) {
          guidance = 'Location unavailable. Please make sure your device GPS/Location Services are turned on.';
        } else if (locErr.code === 3) {
          guidance = 'Location request timed out. Please verify strong GPS reception and try again.';
        }

        setErrorMessage(`Driver Location Required: ${guidance}`);
        return;
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
      </form>
    </div>
  );
}

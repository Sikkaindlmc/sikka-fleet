'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { apiRequest } from '../lib/api';

export interface DriverPlantInfo {
  id?: string;
  name: string;
  location?: string;
  radiusMeters?: number;
  latitude?: number;
  longitude?: number;
}

export interface DriverLocationSummary {
  driver: {
    id: string;
    driverName: string;
    dlNumber: string;
    mobileNumber: string;
    status: string;
  };
  currentStatus: 'Inside' | 'Outside';
  isInside: boolean;
  isOutside: boolean;
  currentPlant: DriverPlantInfo | null;
  inTime: string | null;
  outTime: string | null;
  lastLocation: {
    latitude: number;
    longitude: number;
    accuracy: number | null;
    capturedAt: string | null;
  } | null;
  lastLocationUpdateAt: string | null;
  isStale: boolean;
  staleThresholdMinutes: number;
  refreshIntervalMinutes: number;
  serverTime: string;
}

const REFRESH_INTERVAL_MS = 20 * 60 * 1000; // 20 minutes (Requirement 16)
const STALE_THRESHOLD_MS = 25 * 60 * 1000; // 25 minutes threshold

export function useDriverLocation(enabled = true) {
  const [summary, setSummary] = useState<DriverLocationSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastCheckTime, setLastCheckTime] = useState<Date>(new Date());
  const [locationError, setLocationError] = useState<string | null>(null);

  const lastSuccessfulSendRef = useRef<number>(Date.now());

  // Fetch current summary from backend
  const fetchSummary = useCallback(async () => {
    try {
      const data = await apiRequest<DriverLocationSummary>('/drivers/my-status');
      setSummary(data);
      if (data.lastLocationUpdateAt) {
        lastSuccessfulSendRef.current = new Date(data.lastLocationUpdateAt).getTime();
      }
      setLocationError(null);
    } catch (err: any) {
      if (err.status !== 401) {
        setLocationError(err.message || 'Unable to fetch driver location status.');
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Send coordinates to backend for geofencing and automatic Plant IN/OUT detection
  const reportLocation = useCallback(async (latitude: number, longitude: number, accuracy?: number) => {
    setIsRefreshing(true);
    try {
      const data = await apiRequest<DriverLocationSummary & { message: string }>('/drivers/location', {
        method: 'POST',
        body: JSON.stringify({
          latitude,
          longitude,
          accuracy: accuracy || null,
        }),
      });

      setSummary(data);
      lastSuccessfulSendRef.current = Date.now();
      setLastCheckTime(new Date());
      setLocationError(null);
      return data;
    } catch (err: any) {
      setLocationError(err.message || 'Failed to update driver location with server.');
      throw err;
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  // Request high-accuracy GPS coordinates from device
  const refreshLocationNow = useCallback((): Promise<void> => {
    if (!('geolocation' in navigator)) {
      setLocationError('Geolocation is not supported by this device/browser.');
      return Promise.resolve();
    }

    setIsRefreshing(true);
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          try {
            await reportLocation(
              position.coords.latitude,
              position.coords.longitude,
              position.coords.accuracy
            );
          } catch {
            // Handled in reportLocation
          } finally {
            resolve();
          }
        },
        (error) => {
          setIsRefreshing(false);
          // Requirement 17: If GPS fails/denied, do not report fake location or fake IN/OUT
          setLocationError(`GPS Location Error: ${error.message} (${error.code})`);
          resolve();
        },
        {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 0,
        }
      );
    });
  }, [reportLocation]);

  // Periodic 20-minute cycle & background resumption
  useEffect(() => {
    if (!enabled) return;

    // Initial fetch of current server status
    fetchSummary();

    // Trigger initial device location sync
    refreshLocationNow();

    // 20-Minute Periodic Timer (Requirement 16)
    const intervalId = setInterval(() => {
      refreshLocationNow();
    }, REFRESH_INTERVAL_MS);

    // Requirement 17: Background / Minimized Resumption Check
    // When driver returns to the tab/app, check if 20 minutes have passed and refresh immediately
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const elapsed = Date.now() - lastSuccessfulSendRef.current;
        if (elapsed >= REFRESH_INTERVAL_MS) {
          refreshLocationNow();
        } else {
          // Re-fetch server status silently
          fetchSummary();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [enabled, fetchSummary, refreshLocationNow]);

  // Dynamic Stale Status evaluation
  const isStale = summary?.lastLocationUpdateAt
    ? (Date.now() - new Date(summary.lastLocationUpdateAt).getTime()) > STALE_THRESHOLD_MS
    : true;

  return {
    summary,
    isLoading,
    isRefreshing,
    isStale,
    locationError,
    lastCheckTime,
    refreshLocationNow,
    fetchSummary,
  };
}

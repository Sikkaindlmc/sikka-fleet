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
  locationDeductionStatus: 'Location Deducted' | 'Location Not Deducted';
  isLocationDeducted: boolean;
  lastLocationAttemptAt: string | null;
  lastLocationError: string | null;
  isStale: boolean;
  refreshIntervalMinutes: number;
  serverTime: string;
}

const REFRESH_INTERVAL_MS = 20 * 60 * 1000; // 20 minutes (Requirement 1)
const STALE_THRESHOLD_MS = 21 * 60 * 1000; // 21 minutes threshold

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

  // Send genuine coordinates to backend for geofencing and automatic location deduction
  // Requirement 5: Stores Driver Name, ID, Lat, Lon, Date/Time, Accuracy, Status: Location Deducted
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
      setSummary((prev) =>
        prev
          ? {
              ...prev,
              locationDeductionStatus: 'Location Not Deducted',
              isLocationDeducted: false,
            }
          : null
      );
      throw err;
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  // Handle location fetch failure
  // Requirements 2, 3, 4: Never save location record, never use previous location, display "Location Not Deducted"
  const reportLocationFailure = useCallback(async (reason: string) => {
    setIsRefreshing(false);
    setLocationError(reason);
    try {
      const data = await apiRequest<DriverLocationSummary & { message: string }>('/drivers/location-failed', {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
      setSummary(data);
    } catch {
      // Local optimistic fallback if offline
      setSummary((prev) =>
        prev
          ? {
              ...prev,
              locationDeductionStatus: 'Location Not Deducted',
              isLocationDeducted: false,
            }
          : null
      );
    }
  }, []);

  // Request high-accuracy GPS coordinates from device
  const refreshLocationNow = useCallback((): Promise<void> => {
    if (!('geolocation' in navigator)) {
      const msg = 'Geolocation is not supported by this device or browser.';
      reportLocationFailure(msg);
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
            // Handled inside reportLocation
          } finally {
            resolve();
          }
        },
        async (error) => {
          // Requirements 2, 3, 4: Location fetch failure must display "Location Not Deducted"
          // and NEVER create a location record or use previous location
          const errorMsg = `GPS Unavailable (${error.code}): ${error.message}`;
          await reportLocationFailure(errorMsg);
          resolve();
        },
        {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 0,
        }
      );
    });
  }, [reportLocation, reportLocationFailure]);

  // Periodic 20-minute cycle & background resumption
  // Requirement 1: Deduct current location every 20 minutes automatically
  useEffect(() => {
    if (!enabled) return;

    // Initial fetch of current server status
    fetchSummary();

    // Trigger initial device location sync
    refreshLocationNow();

    // 20-Minute Periodic Timer (Every 20 minutes)
    const intervalId = setInterval(() => {
      refreshLocationNow();
    }, REFRESH_INTERVAL_MS);

    // Background / Minimized Resumption Check
    // When driver returns to tab/app, check if 20 minutes have passed and refresh immediately
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const elapsed = Date.now() - lastSuccessfulSendRef.current;
        if (elapsed >= REFRESH_INTERVAL_MS) {
          refreshLocationNow();
        } else {
          // Re-fetch server status to get latest evaluated status
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

  // Dynamic status evaluation
  const isStale = summary?.lastLocationUpdateAt
    ? (Date.now() - new Date(summary.lastLocationUpdateAt).getTime()) > STALE_THRESHOLD_MS
    : true;

  const currentDeductionStatus: 'Location Deducted' | 'Location Not Deducted' =
    !isStale && summary?.locationDeductionStatus === 'Location Deducted'
      ? 'Location Deducted'
      : 'Location Not Deducted';

  return {
    summary: summary ? { ...summary, locationDeductionStatus: currentDeductionStatus } : null,
    isLoading,
    isRefreshing,
    isStale,
    locationDeductionStatus: currentDeductionStatus,
    locationError,
    lastCheckTime,
    refreshLocationNow,
    fetchSummary,
  };
}

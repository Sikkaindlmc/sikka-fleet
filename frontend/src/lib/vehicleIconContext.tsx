'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { apiRequest } from './api';

interface VehicleIconContextType {
  vehicleIcon: string | null;
  isLoading: boolean;
  updateVehicleIcon: (iconDataUrl: string) => Promise<void>;
  resetVehicleIcon: () => Promise<void>;
  reloadVehicleIcon: () => Promise<void>;
}

const VehicleIconContext = createContext<VehicleIconContextType | undefined>(undefined);

export function VehicleIconProvider({ children }: { children: React.ReactNode }) {
  const [vehicleIcon, setVehicleIcon] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load persisted icon from localStorage first for instantaneous render
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const cached = localStorage.getItem('sikka_vehicle_icon');
      if (cached) {
        setVehicleIcon(cached);
      }
    }
  }, []);

  // Fetch latest active vehicle icon from backend
  const reloadVehicleIcon = useCallback(async () => {
    try {
      const data = await apiRequest<{ vehicleIcon: string }>('/gps/vehicle-icon');
      if (data.vehicleIcon) {
        setVehicleIcon(data.vehicleIcon);
        if (typeof window !== 'undefined') {
          localStorage.setItem('sikka_vehicle_icon', data.vehicleIcon);
        }
      } else {
        setVehicleIcon(null);
        if (typeof window !== 'undefined') {
          localStorage.removeItem('sikka_vehicle_icon');
        }
      }
    } catch {
      // If offline or not authenticated yet, keep cached
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    reloadVehicleIcon();
  }, [reloadVehicleIcon]);

  const updateVehicleIcon = async (iconDataUrl: string) => {
    const res = await apiRequest<{ vehicleIcon: string }>('/gps/vehicle-icon', {
      method: 'POST',
      body: JSON.stringify({ vehicleIcon: iconDataUrl }),
    });

    setVehicleIcon(res.vehicleIcon);
    if (typeof window !== 'undefined') {
      localStorage.setItem('sikka_vehicle_icon', res.vehicleIcon);
    }
  };

  const resetVehicleIcon = async () => {
    await apiRequest('/gps/vehicle-icon', {
      method: 'DELETE',
    });

    setVehicleIcon(null);
    if (typeof window !== 'undefined') {
      localStorage.removeItem('sikka_vehicle_icon');
    }
  };

  return (
    <VehicleIconContext.Provider
      value={{
        vehicleIcon,
        isLoading,
        updateVehicleIcon,
        resetVehicleIcon,
        reloadVehicleIcon,
      }}
    >
      {children}
    </VehicleIconContext.Provider>
  );
}

export function useVehicleIcon() {
  const context = useContext(VehicleIconContext);
  if (!context) {
    throw new Error('useVehicleIcon must be used within a VehicleIconProvider');
  }
  return context;
}

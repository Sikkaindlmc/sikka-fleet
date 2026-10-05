'use client';

import React from 'react';
import { Truck } from 'lucide-react';
import { useVehicleIcon } from '../lib/vehicleIconContext';

interface VehicleIconProps {
  className?: string;
  size?: number | string;
  overrideUrl?: string | null;
  alt?: string;
}

export default function VehicleIcon({
  className = 'w-5 h-5',
  size,
  overrideUrl,
  alt = 'Vehicle',
}: VehicleIconProps) {
  const { vehicleIcon } = useVehicleIcon();
  const iconSrc = overrideUrl !== undefined ? overrideUrl : vehicleIcon;

  if (iconSrc) {
    return (
      <img
        src={iconSrc}
        alt={alt}
        className={`object-contain inline-block shrink-0 ${className}`}
        style={size ? { width: size, height: size } : undefined}
      />
    );
  }

  return (
    <Truck
      className={`shrink-0 ${className}`}
      style={size ? { width: size, height: size } : undefined}
    />
  );
}

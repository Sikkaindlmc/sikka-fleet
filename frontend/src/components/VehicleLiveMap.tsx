'use client';

import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ExternalLink, Crosshair, Layers, Navigation } from 'lucide-react';
import { useVehicleIcon } from '../lib/vehicleIconContext';

interface VehicleLiveMapProps {
  vehicleNumber: string;
  latitude: number;
  longitude: number;
  speed: number;
  readableLocation?: string;
  readableTime?: string;
  plantName?: string;
  heightClass?: string;
}

type MapLayerType = 'googleRoad' | 'googleSat' | 'osm';

const TILE_LAYERS: Record<MapLayerType, { url: string; attribution: string; maxZoom: number; subdomains?: string[] }> = {
  googleRoad: {
    url: 'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
    attribution: '&copy; Google Maps',
    maxZoom: 20,
  },
  googleSat: {
    url: 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
    attribution: '&copy; Google Maps Satellite',
    maxZoom: 20,
  },
  osm: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
    subdomains: ['a', 'b', 'c'],
  },
};

export default function VehicleLiveMap({
  vehicleNumber,
  latitude,
  longitude,
  speed,
  readableLocation,
  readableTime,
  plantName,
  heightClass = 'h-80 sm:h-96',
}: VehicleLiveMapProps) {
  const { vehicleIcon } = useVehicleIcon();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);

  const [activeLayer, setActiveLayer] = useState<MapLayerType>('googleRoad');
  const [showLayerMenu, setShowLayerMenu] = useState(false);

  // Helper to create the custom vehicle icon pin HTML
  const createVehiclePinHtml = (iconUrl: string | null, vehNum: string, isMoving: boolean, curSpeed: number) => {
    const isCustom = !!iconUrl;
    const movingBadge = isMoving
      ? `<span style="background:#10b981;color:#ffffff;font-size:9px;padding:1px 5px;border-radius:9999px;font-weight:700;">${Math.round(curSpeed)} km/h</span>`
      : `<span style="background:#64748b;color:#ffffff;font-size:9px;padding:1px 5px;border-radius:9999px;font-weight:700;">Stopped</span>`;

    const iconContent = isCustom
      ? `<img src="${iconUrl}" alt="${vehNum}" style="width:34px;height:34px;object-fit:contain;display:block;" />`
      : `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg>`;

    return `
      <div style="position:relative;display:flex;flex-direction:column;align-items:center;cursor:pointer;transform:translate3d(0,0,0);">
        <!-- Top Vehicle Pill Badge -->
        <div style="background:rgba(15,23,42,0.92);backdrop-filter:blur(4px);color:#ffffff;padding:2px 7px;border-radius:9999px;font-size:10px;font-weight:800;letter-spacing:0.5px;box-shadow:0 4px 12px rgba(0,0,0,0.3);white-space:nowrap;display:flex;align-items:center;gap:4px;border:1px solid rgba(255,255,255,0.2);margin-bottom:3px;">
          <span>${vehNum}</span>
          ${movingBadge}
        </div>

        <!-- Custom Vehicle Pin Body -->
        <div class="vehicle-pin-body" style="position:relative;width:48px;height:48px;border-radius:16px;background:#ffffff;border:3px solid ${isMoving ? '#10b981' : '#059669'};box-shadow:0 8px 20px rgba(0,0,0,0.25), 0 0 0 4px ${isMoving ? 'rgba(16,185,129,0.25)' : 'rgba(5,150,105,0.15)'};display:flex;align-items:center;justify-content:center;padding:4px;transition:transform 0.2s ease;">
          ${iconContent}
        </div>

        <!-- Pointer Tip Arrow -->
        <div style="width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-top:9px solid ${isMoving ? '#10b981' : '#059669'};margin-top:-1px;"></div>

        <!-- Radar Pulse Dot at Anchor Base -->
        <div style="position:relative;width:12px;height:12px;margin-top:2px;display:flex;align-items:center;justify-content:center;">
          <div style="position:absolute;width:12px;height:12px;border-radius:9999px;background:#10b981;opacity:0.75;animation:ping 1.5s cubic-bezier(0,0,0.2,1) infinite;"></div>
          <div style="position:relative;width:6px;height:6px;border-radius:9999px;background:#047857;box-shadow:0 0 4px rgba(0,0,0,0.4);"></div>
        </div>
      </div>
    `;
  };

  // Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: [latitude, longitude],
        zoom: 16,
        zoomControl: false,
        attributionControl: false,
      });

      // Add zoom control at bottom-left
      L.control
        .zoom({
          position: 'bottomleft',
        })
        .addTo(map);

      // Add default tile layer
      const layerConfig = TILE_LAYERS[activeLayer];
      const tiles = L.tileLayer(layerConfig.url, {
        maxZoom: layerConfig.maxZoom,
        subdomains: layerConfig.subdomains || [],
      }).addTo(map);

      tileLayerRef.current = tiles;
      mapInstanceRef.current = map;
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        markerRef.current = null;
        tileLayerRef.current = null;
      }
    };
  }, []);

  // Update Tile Layer if changed
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
    }

    const layerConfig = TILE_LAYERS[activeLayer];
    const newTiles = L.tileLayer(layerConfig.url, {
      maxZoom: layerConfig.maxZoom,
      subdomains: layerConfig.subdomains || [],
    }).addTo(map);

    tileLayerRef.current = newTiles;
  }, [activeLayer]);

  // Update Marker and Pan to vehicle when coordinates or icon change
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    const isMoving = speed > 0;
    const pinHtml = createVehiclePinHtml(vehicleIcon, vehicleNumber, isMoving, speed);

    const customDivIcon = L.divIcon({
      className: 'vehicle-custom-pin-marker',
      html: pinHtml,
      iconSize: [60, 90],
      iconAnchor: [30, 85], // Anchored precisely at the radar dot base
      popupAnchor: [0, -85],
    });

    const popupHtml = `
      <div style="font-family:inherit;padding:2px;min-width:180px;">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
          <span style="font-weight:800;font-size:13px;color:#0f172a;">${vehicleNumber}</span>
          <span style="font-size:9px;font-weight:700;padding:1px 6px;border-radius:9999px;background:${isMoving ? '#d1fae5' : '#f1f5f9'};color:${isMoving ? '#065f46' : '#475569'};">
            ${isMoving ? `${Math.round(speed)} km/h` : 'Stopped'}
          </span>
        </div>
        ${readableLocation ? `<p style="font-size:11px;color:#334155;margin:0 0 4px 0;line-height:1.3;">${readableLocation}</p>` : ''}
        ${readableTime ? `<p style="font-size:10px;color:#64748b;margin:0 0 6px 0;">Updated: ${readableTime}</p>` : ''}
        <a href="https://maps.google.com/?q=${latitude},${longitude}" target="_blank" rel="noopener noreferrer" style="display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:700;color:#059669;text-decoration:none;">
          Open in Google Maps &rarr;
        </a>
      </div>
    `;

    if (!markerRef.current) {
      const marker = L.marker([latitude, longitude], { icon: customDivIcon })
        .addTo(map)
        .bindPopup(popupHtml);
      markerRef.current = marker;
    } else {
      markerRef.current.setLatLng([latitude, longitude]);
      markerRef.current.setIcon(customDivIcon);
      markerRef.current.setPopupContent(popupHtml);
    }

    // Pan map to vehicle position
    map.panTo([latitude, longitude], { animate: true, duration: 0.5 });
  }, [latitude, longitude, vehicleNumber, speed, vehicleIcon, readableLocation, readableTime]);

  // Recenter map button handler
  const handleRecenter = () => {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.flyTo([latitude, longitude], 17, { duration: 0.8 });
    }
  };

  return (
    <div className={`relative w-full ${heightClass} rounded-2xl overflow-hidden border border-slate-200 shadow-inner bg-slate-100`}>
      {/* Map DOM Element */}
      <div ref={mapContainerRef} className="w-full h-full z-0" />

      {/* Floating Vehicle Info Pill (Top-Left) */}
      <div className="absolute top-3 left-3 z-10 bg-white/95 backdrop-blur-md px-3.5 py-2.5 rounded-xl shadow-lg border border-slate-200/90 flex items-center gap-3 pointer-events-auto">
        <div className="w-9 h-9 rounded-xl bg-emerald-500 text-slate-950 flex items-center justify-center p-1.5 font-bold shadow-xs shrink-0 overflow-hidden">
          {vehicleIcon ? (
            <img src={vehicleIcon} alt="Vehicle Icon" className="w-full h-full object-contain" />
          ) : (
            <Navigation className="w-5 h-5 text-slate-950" />
          )}
        </div>
        <div>
          <div className="flex items-center gap-1.5">
            <span className="font-extrabold text-xs text-slate-900 tracking-wide">
              {vehicleNumber}
            </span>
            <span
              className={`px-1.5 py-0.2 rounded text-[9px] font-bold ${
                speed > 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {speed > 0 ? `${Math.round(speed)} km/h` : 'Stopped'}
            </span>
          </div>
          <span className="text-[10px] text-slate-500 font-medium block truncate max-w-[200px] sm:max-w-[280px]">
            {readableLocation || 'Live GPS Track'}
          </span>
        </div>
      </div>

      {/* Floating Controls (Top-Right): Recenter & Map Layer Switcher */}
      <div className="absolute top-3 right-3 z-10 flex items-center gap-2 pointer-events-auto">
        {/* Recenter Button */}
        <button
          type="button"
          onClick={handleRecenter}
          className="inline-flex items-center gap-1 px-2.5 py-2 bg-white/95 hover:bg-white text-slate-700 hover:text-slate-900 text-xs font-bold rounded-xl shadow-md border border-slate-200/90 transition cursor-pointer"
          title="Center on Vehicle"
        >
          <Crosshair className="w-3.5 h-3.5 text-emerald-600" />
          <span className="hidden sm:inline">Center</span>
        </button>

        {/* Map Layer Switcher Button */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowLayerMenu((prev) => !prev)}
            className="inline-flex items-center gap-1 px-2.5 py-2 bg-white/95 hover:bg-white text-slate-700 hover:text-slate-900 text-xs font-bold rounded-xl shadow-md border border-slate-200/90 transition cursor-pointer"
            title="Change Map Style"
          >
            <Layers className="w-3.5 h-3.5 text-slate-600" />
            <span className="hidden sm:inline">
              {activeLayer === 'googleRoad' ? 'Google Map' : activeLayer === 'googleSat' ? 'Satellite' : 'OSM'}
            </span>
          </button>

          {showLayerMenu && (
            <div className="absolute right-0 mt-1.5 w-40 bg-white rounded-xl shadow-xl border border-slate-200 p-1.5 z-20 space-y-1">
              <button
                type="button"
                onClick={() => {
                  setActiveLayer('googleRoad');
                  setShowLayerMenu(false);
                }}
                className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center justify-between ${
                  activeLayer === 'googleRoad' ? 'bg-emerald-50 text-emerald-800' : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <span>Google Map</span>
                {activeLayer === 'googleRoad' && <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />}
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveLayer('googleSat');
                  setShowLayerMenu(false);
                }}
                className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center justify-between ${
                  activeLayer === 'googleSat' ? 'bg-emerald-50 text-emerald-800' : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <span>Satellite</span>
                {activeLayer === 'googleSat' && <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />}
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveLayer('osm');
                  setShowLayerMenu(false);
                }}
                className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center justify-between ${
                  activeLayer === 'osm' ? 'bg-emerald-50 text-emerald-800' : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <span>OpenStreetMap</span>
                {activeLayer === 'osm' && <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Floating External Google Maps Link (Bottom-Right) */}
      <div className="absolute bottom-3 right-3 z-10 flex items-center gap-2 pointer-events-auto">
        <a
          href={`https://maps.google.com/?q=${latitude},${longitude}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/95 hover:bg-white text-slate-800 text-xs font-bold rounded-xl shadow-md border border-slate-200/90 transition"
        >
          <ExternalLink className="w-3.5 h-3.5 text-slate-600" />
          <span>Google Maps</span>
        </a>
      </div>

      {/* Custom Styles for Leaflet Pin Marker */}
      <style jsx global>{`
        .vehicle-custom-pin-marker {
          background: transparent !important;
          border: none !important;
        }
        .vehicle-custom-pin-marker:hover .vehicle-pin-body {
          transform: scale(1.1);
        }
      `}</style>
    </div>
  );
}

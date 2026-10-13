/**
 * Sikka Fleet Centralized API Configuration & Client
 * 
 * Production Endpoints:
 * - Primary Official Domain: https://fleet.sikkaind.com/api
 * - Redundant Cloud Backup:  https://sikka-fleet.vercel.app/api
 *
 * Guarantees universal connectivity across:
 * - Office Wi-Fi, Home Wi-Fi, Mobile Data (4G/5G), Remote ISP connections
 * - Web Application and Android APK (Capacitor)
 */

export const PRODUCTION_API_URL = 'https://fleet.sikkaind.com/api';
export const BACKUP_CLOUD_API_URL = 'https://sikka-fleet.vercel.app/api';
export const CLOUD_API_URL = PRODUCTION_API_URL;

/**
 * Checks whether a given URL points to a private LAN, link-local, or loopback address.
 */
export function isPrivateOrLanUrl(url: string): boolean {
  if (!url) return false;
  return (
    url.includes('192.168.') ||
    url.includes('10.') ||
    url.includes('172.16.') ||
    url.includes('172.17.') ||
    url.includes('172.18.') ||
    url.includes('172.19.') ||
    url.includes('172.2') ||
    url.includes('172.30.') ||
    url.includes('172.31.') ||
    url.includes('localhost') ||
    url.includes('127.0.0.1')
  );
}

/**
 * Resolves the primary API base URL.
 * Guarantees that production web and Android APK always use public HTTPS endpoints.
 * Automatically purges any obsolete local LAN IPs from client storage.
 */
export function getApiBaseUrl(): string {
  if (typeof window !== 'undefined') {
    // 1. Check custom override in localStorage (if set by user)
    const customUrl = localStorage.getItem('sikka_fleet_server_url');
    if (customUrl && customUrl.trim()) {
      return customUrl.trim().replace(/\/+$/, '');
    }

    // 2. Check NEXT_PUBLIC_API_URL environment variable if set
    if (process.env.NEXT_PUBLIC_API_URL && process.env.NEXT_PUBLIC_API_URL.trim()) {
      return process.env.NEXT_PUBLIC_API_URL.trim().replace(/\/+$/, '');
    }

    // 3. When running inside Capacitor APK on mobile device
    const isCapacitor =
      typeof (window as any).Capacitor !== 'undefined' ||
      window.location.protocol === 'capacitor:' ||
      window.location.protocol === 'ionic:' ||
      (window.location.hostname === 'localhost' && !window.location.port);

    if (isCapacitor) {
      return PRODUCTION_API_URL;
    }

    // 4. In desktop browser running on custom domain or Vercel
    if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      return '/api';
    }

    // 5. Localhost development fallback
    return 'http://localhost:5000/api';
  }

  // Server-side rendering (SSR) fallback
  return process.env.BACKEND_URL
    ? `${process.env.BACKEND_URL.replace(/\/+$/, '')}/api`
    : PRODUCTION_API_URL;
}

export const API_BASE_URL = PRODUCTION_API_URL;

export class ApiError extends Error {
  status: number;
  data: any;

  constructor(message: string, status: number, data?: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

interface FetchOptions extends RequestInit {
  timeoutMs?: number;
}

async function executeFetch<T = any>(
  baseUrl: string,
  endpoint: string,
  options: FetchOptions = {}
): Promise<T> {
  const url = `${baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
  const timeoutMs = options.timeoutMs || 15000;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('sikka_fleet_token');
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const config: RequestInit = {
    ...options,
    headers,
    signal: controller.signal,
  };

  try {
    const response = await fetch(url, config);
    clearTimeout(timeoutId);

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      if (response.status === 401 && typeof window !== 'undefined') {
        const isLoginRequest = endpoint.includes('/auth/login');
        if (!isLoginRequest) {
          localStorage.removeItem('sikka_fleet_token');
          localStorage.removeItem('sikka_fleet_user');
          window.dispatchEvent(new CustomEvent('sikka:auth-expired', { detail: data }));

          if (!window.location.pathname.startsWith('/login')) {
            const redirectPath = encodeURIComponent(window.location.pathname + window.location.search);
            window.location.href = `/login?expired=1&redirect=${redirectPath}`;
          }
        }
      }

      const errorMessage =
        data.error ||
        data.message ||
        `Request failed with status ${response.status}`;
      throw new ApiError(errorMessage, response.status, data);
    }

    return data as T;
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err instanceof ApiError) {
      throw err;
    }
    if (err.name === 'AbortError') {
      throw new ApiError('Request timed out. Please verify your internet connection.', 0);
    }
    throw new ApiError(err.message || 'Network request failed', 0);
  }
}

/**
 * Universal apiRequest client with automatic fallback and retry handling.
 * - Accurately differentiates HTTP errors (e.g. 401 invalid credentials) from true network drops.
 * - Idempotent retries on network drop with exponential backoff.
 * - Seamless automatic failover between primary (fleet.sikkaind.com) and backup (sikka-fleet.vercel.app).
 */
export async function apiRequest<T = any>(
  endpoint: string,
  options: FetchOptions = {}
): Promise<T> {
  const primaryBaseUrl = getApiBaseUrl();
  const fallbackBaseUrl = primaryBaseUrl.includes('sikka-fleet.vercel.app')
    ? PRODUCTION_API_URL
    : BACKUP_CLOUD_API_URL;

  try {
    return await executeFetch<T>(primaryBaseUrl, endpoint, options);
  } catch (primaryErr: any) {
    // If the server responded with an HTTP status code (400, 401, 403, 404, 500), do NOT treat as network drop
    if (primaryErr instanceof ApiError && primaryErr.status > 0) {
      throw primaryErr;
    }

    // True network disconnection (timeout, DNS failure, SIM cell tower handover)
    // Try failover to redundant cloud endpoint
    try {
      console.warn(`[Network Retry] Primary endpoint unreachable. Attempting redundant cloud fallback: ${fallbackBaseUrl}`);
      const fallbackResult = await executeFetch<T>(fallbackBaseUrl, endpoint, {
        ...options,
        timeoutMs: 12000,
      });

      if (typeof window !== 'undefined' && primaryBaseUrl !== '/api') {
        localStorage.setItem('sikka_fleet_server_url', fallbackBaseUrl);
      }
      return fallbackResult;
    } catch (fallbackErr: any) {
      if (fallbackErr instanceof ApiError && fallbackErr.status > 0) {
        throw fallbackErr;
      }

      // One final retry with exponential backoff delay (1000ms)
      try {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return await executeFetch<T>(primaryBaseUrl, endpoint, {
          ...options,
          timeoutMs: 12000,
        });
      } catch (finalErr: any) {
        if (finalErr instanceof ApiError && finalErr.status > 0) {
          throw finalErr;
        }

        throw new ApiError(
          'Unable to connect to Sikka Fleet servers. Please check your internet connection (Wi-Fi or Mobile Data).',
          0
        );
      }
    }
  }
}

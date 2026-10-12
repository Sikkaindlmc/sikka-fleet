export const CLOUD_API_URL = 'https://sikka-fleet.vercel.app/api';
export const LOCAL_API_URL = 'http://192.168.1.38:5000/api';

export function getApiBaseUrl(): string {
  if (typeof window !== 'undefined') {
    const customUrl = localStorage.getItem('sikka_fleet_server_url');
    // If the stored URL is the obsolete local LAN IP on mobile, migrate to Cloud URL
    if (customUrl === 'http://192.168.1.38:5000/api') {
      localStorage.setItem('sikka_fleet_server_url', CLOUD_API_URL);
      return CLOUD_API_URL;
    }
    if (customUrl && customUrl.trim()) {
      return customUrl.trim().replace(/\/+$/, '');
    }
  }

  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL.replace(/\/+$/, '');
  }

  if (typeof window !== 'undefined') {
    // Check if running inside mobile hybrid wrapper (Capacitor)
    const isCapacitor = !!(window as any).Capacitor;
    if (isCapacitor) {
      // Default to live cloud server so it works globally on cellular 4G/5G and Wi-Fi
      return CLOUD_API_URL;
    }
    if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      return '/api';
    }
    return 'http://localhost:5000/api';
  }

  return process.env.BACKEND_URL
    ? `${process.env.BACKEND_URL}/api`
    : CLOUD_API_URL;
}

export const API_BASE_URL = getApiBaseUrl();

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

async function executeFetch<T = any>(
  baseUrl: string,
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

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

  const config: RequestInit = {
    ...options,
    headers,
  };

  const response = await fetch(url, config);
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
}

export async function apiRequest<T = any>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const primaryBaseUrl = getApiBaseUrl();
  const alternateBaseUrl = primaryBaseUrl.includes('vercel.app')
    ? LOCAL_API_URL
    : CLOUD_API_URL;

  try {
    return await executeFetch<T>(primaryBaseUrl, endpoint, options);
  } catch (primaryErr: any) {
    // If server responded with an HTTP status code (401, 403, 400, etc.), do not failover
    if (primaryErr instanceof ApiError && primaryErr.status > 0) {
      throw primaryErr;
    }

    // Network connection failure (e.g. phone on cellular data cannot reach local LAN IP)
    // Automatically try the alternate server
    try {
      console.warn(`[API Failover] Connection to ${primaryBaseUrl} failed. Trying ${alternateBaseUrl}...`);
      const fallbackResult = await executeFetch<T>(alternateBaseUrl, endpoint, options);
      if (typeof window !== 'undefined') {
        localStorage.setItem('sikka_fleet_server_url', alternateBaseUrl);
      }
      return fallbackResult;
    } catch (fallbackErr: any) {
      if (fallbackErr instanceof ApiError && fallbackErr.status > 0) {
        throw fallbackErr;
      }

      throw new ApiError(
        `Unable to reach fleet servers (${primaryBaseUrl}). Please check your internet connection or verify backend server is active.`,
        0
      );
    }
  }
}

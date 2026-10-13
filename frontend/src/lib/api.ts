export const CLOUD_API_URL = 'https://sikka-fleet.vercel.app/api';

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
 * Guarantees that production web and Android APK always use the public HTTPS endpoint.
 * Automatically purges any obsolete local LAN IPs from client storage.
 */
export function getApiBaseUrl(): string {
  if (typeof window !== 'undefined') {
    const customUrl = localStorage.getItem('sikka_fleet_server_url');
    if (customUrl && customUrl.trim()) {
      const trimmed = customUrl.trim().replace(/\/+$/, '');
      // If a local LAN IP (e.g., 192.168.1.38:5000 or localhost) was saved in mobile storage,
      // purge it immediately and reset to the production Cloud API URL.
      if (isPrivateOrLanUrl(trimmed)) {
        localStorage.setItem('sikka_fleet_server_url', CLOUD_API_URL);
        return CLOUD_API_URL;
      }
      return trimmed;
    }

    if (process.env.NEXT_PUBLIC_API_URL && process.env.NEXT_PUBLIC_API_URL.trim()) {
      return process.env.NEXT_PUBLIC_API_URL.trim().replace(/\/+$/, '');
    }

    // When running inside Capacitor APK on mobile device
    const isCapacitor =
      typeof (window as any).Capacitor !== 'undefined' ||
      window.location.protocol === 'capacitor:' ||
      window.location.protocol === 'ionic:' ||
      (window.location.hostname === 'localhost' && !window.location.port);

    if (isCapacitor) {
      return CLOUD_API_URL;
    }

    // In desktop browser running on Vercel or custom domain
    if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      return '/api';
    }

    return CLOUD_API_URL;
  }

  return process.env.BACKEND_URL
    ? `${process.env.BACKEND_URL.replace(/\/+$/, '')}/api`
    : CLOUD_API_URL;
}

export const API_BASE_URL = CLOUD_API_URL;

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

  try {
    return await executeFetch<T>(primaryBaseUrl, endpoint, options);
  } catch (primaryErr: any) {
    // If the server responded with an HTTP status code (400, 401, 403, 404, 500, etc.), do not retry
    if (primaryErr instanceof ApiError && primaryErr.status > 0) {
      throw primaryErr;
    }

    // Network connection drop (e.g. mobile SIM handover from 4G to 5G or Wi-Fi reconnect)
    // Perform one automatic retry against CLOUD_API_URL
    try {
      if (primaryBaseUrl !== CLOUD_API_URL) {
        return await executeFetch<T>(CLOUD_API_URL, endpoint, options);
      }
      // Brief 500ms delay before retry
      await new Promise((resolve) => setTimeout(resolve, 500));
      return await executeFetch<T>(primaryBaseUrl, endpoint, options);
    } catch (retryErr: any) {
      if (retryErr instanceof ApiError && retryErr.status > 0) {
        throw retryErr;
      }

      throw new ApiError(
        'Unable to reach Sikka Fleet servers. Please check your internet connection (Wi-Fi or Mobile Data).',
        0
      );
    }
  }
}

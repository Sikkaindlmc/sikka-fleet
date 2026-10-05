const isClient = typeof window !== 'undefined';
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  (isClient
    ? (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1'
        ? '/api'
        : 'http://localhost:5000/api')
    : (process.env.BACKEND_URL
        ? `${process.env.BACKEND_URL}/api`
        : 'http://localhost:5000/api'));

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

export async function apiRequest<T = any>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

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

  try {
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
  } catch (err: any) {
    if (err instanceof ApiError) {
      throw err;
    }
    throw new ApiError(
      err.message || 'Unable to connect to the fleet management server.',
      0
    );
  }
}

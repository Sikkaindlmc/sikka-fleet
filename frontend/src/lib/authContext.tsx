'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiRequest, ApiError, refreshSession } from './api';

export interface UserProfile {
  id: string;
  fullName: string;
  username: string;
  role?: string;
  accessPages: string[];
  accessPlants: Array<{ _id: string; plantName: string; status?: string } | string>;
  status: string;
}

interface AuthContextType {
  user: UserProfile | null;
  token: string | null;
  isLoading: boolean;
  login: (
    username: string,
    password: string,
    loginType?: 'User' | 'Driver',
    location?: { latitude: number; longitude: number; accuracy?: number | null }
  ) => Promise<void>;
  logout: () => Promise<void>;
  hasPageAccess: (pageName: string) => boolean;
  hasPlantAccess: (plantId: string) => boolean;
  refreshUser: () => Promise<void>;
}

interface AuthResponse {
  token: string;
  user: UserProfile;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function isSessionInvalid(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 401 &&
    (error.data?.code === 'SESSION_INVALID' || error.data?.code === 'SESSION_REVOKED')
  );
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    let active = true;

    const clearSession = () => {
      localStorage.removeItem('sikka_fleet_token');
      localStorage.removeItem('sikka_fleet_user');
      localStorage.setItem('sikka_fleet_logged_out', '1');
      if (active) {
        setToken(null);
        setUser(null);
      }
    };

    const handleAuthExpired = () => {
      clearSession();
      if (!window.location.pathname.startsWith('/login')) {
        router.replace('/login?expired=1');
      }
    };

    const handleSessionRefreshed = (event: Event) => {
      const session = (event as CustomEvent<AuthResponse>).detail;
      if (active && session) {
        setToken(session.token);
        setUser(session.user);
      }
    };

    window.addEventListener('sikka:auth-expired', handleAuthExpired);
    window.addEventListener('sikka:session-refreshed', handleSessionRefreshed);

    const restoreSession = async () => {
      if (localStorage.getItem('sikka_fleet_logged_out') === '1') {
        setIsLoading(false);
        return;
      }

      const cachedToken = localStorage.getItem('sikka_fleet_token');
      const cachedUserValue = localStorage.getItem('sikka_fleet_user');
      let cachedUser: UserProfile | null = null;
      try {
        cachedUser = cachedUserValue ? JSON.parse(cachedUserValue) : null;
      } catch {
        localStorage.removeItem('sikka_fleet_user');
      }

      if (!navigator.onLine && cachedToken && cachedUser) {
        setToken(cachedToken);
        setUser(cachedUser);
        setIsLoading(false);
        return;
      }

      try {
        const session = await refreshSession<AuthResponse['user']>();
        if (active) {
          setToken(session.token);
          setUser(session.user);
        }
      } catch (error) {
        if (isSessionInvalid(error)) {
          clearSession();
        } else if (active && error instanceof ApiError && error.status === 0) {
          // Keep the cached app state through network loss; retry when connectivity returns.
          if (cachedToken && cachedUser) {
            setToken(cachedToken);
            setUser(cachedUser);
          }
        } else if (active && cachedToken && cachedUser) {
          // Service errors are not proof that the user's session has been revoked.
          setToken(cachedToken);
          setUser(cachedUser);
        }
      } finally {
        if (active) setIsLoading(false);
      }
    };

    void restoreSession();

    const refreshOnResume = () => {
      if (
        document.visibilityState === 'visible' &&
        navigator.onLine &&
        localStorage.getItem('sikka_fleet_logged_out') !== '1' &&
        (localStorage.getItem('sikka_fleet_token') || localStorage.getItem('sikka_fleet_user'))
      ) {
        void refreshSession<AuthResponse['user']>().catch((error) => {
          if (isSessionInvalid(error)) handleAuthExpired();
        });
      }
    };
    document.addEventListener('visibilitychange', refreshOnResume);
    window.addEventListener('online', refreshOnResume);

    return () => {
      active = false;
      window.removeEventListener('sikka:auth-expired', handleAuthExpired);
      window.removeEventListener('sikka:session-refreshed', handleSessionRefreshed);
      document.removeEventListener('visibilitychange', refreshOnResume);
      window.removeEventListener('online', refreshOnResume);
    };
  }, [router]);

  useEffect(() => {
    if (!token || localStorage.getItem('sikka_fleet_logged_out') === '1') return;

    // Refresh before the 15-minute access token expires; background tabs also refresh on resume.
    const timer = window.setInterval(() => {
      void refreshSession<AuthResponse['user']>().catch((error) => {
        if (isSessionInvalid(error)) {
          window.dispatchEvent(new CustomEvent('sikka:auth-expired'));
        }
      });
    }, 12 * 60 * 1000);

    return () => window.clearInterval(timer);
  }, [token]);

  const login = async (
    username: string,
    password: string,
    loginType: 'User' | 'Driver' = 'User',
    location?: { latitude: number; longitude: number; accuracy?: number | null }
  ) => {
    const data = await apiRequest<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password, loginType, location }),
    });

    setToken(data.token);
    setUser(data.user);
    localStorage.setItem('sikka_fleet_token', data.token);
    localStorage.setItem('sikka_fleet_user', JSON.stringify(data.user));
    localStorage.removeItem('sikka_fleet_logged_out');
  };

  const logout = async () => {
    // Mark this browser signed out immediately, even if it is temporarily offline.
    localStorage.setItem('sikka_fleet_logged_out', '1');
    localStorage.removeItem('sikka_fleet_token');
    localStorage.removeItem('sikka_fleet_user');
    setToken(null);
    setUser(null);
    router.replace('/login');

    try {
      await apiRequest('/auth/logout', { method: 'POST' });
    } catch (error) {
      console.error(
        '[Logout] Server-side session revocation could not be confirmed.',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  };

  const refreshUser = async () => {
    const data = await apiRequest<{ user: UserProfile }>('/auth/me');
    setUser(data.user);
    localStorage.setItem('sikka_fleet_user', JSON.stringify(data.user));
  };

  const hasPageAccess = (pageName: string): boolean => {
    if (!user) return false;
    if (user.role === 'Driver') return pageName === 'Dashboard';
    if (user.role === 'Admin') return true;
    return Array.isArray(user.accessPages) && user.accessPages.includes(pageName);
  };

  const hasPlantAccess = (plantId: string): boolean => {
    if (!user) return false;
    if (user.role === 'Admin') return true;
    if (!user.accessPlants || user.accessPlants.length === 0) return true;

    return user.accessPlants.some((plant) => {
      const id = typeof plant === 'string' ? plant : plant._id;
      return id === plantId;
    });
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        login,
        logout,
        hasPageAccess,
        hasPlantAccess,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

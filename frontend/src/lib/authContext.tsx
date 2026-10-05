'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiRequest } from './api';

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
  logout: () => void;
  hasPageAccess: (pageName: string) => boolean;
  hasPlantAccess: (plantId: string) => boolean;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    // Listen for auth-expired events dispatched by apiRequest
    const handleAuthExpired = () => {
      setToken(null);
      setUser(null);
      localStorage.removeItem('sikka_fleet_token');
      localStorage.removeItem('sikka_fleet_user');
    };

    window.addEventListener('sikka:auth-expired', handleAuthExpired);

    // Load persisted token and profile on initial client mount
    const storedToken = localStorage.getItem('sikka_fleet_token');
    const storedUser = localStorage.getItem('sikka_fleet_user');

    if (storedToken && storedUser) {
      try {
        setToken(storedToken);
        setUser(JSON.parse(storedUser));

        // Validate token with server in background
        apiRequest<{ user: UserProfile }>('/auth/me')
          .then((data) => {
            setUser(data.user);
            localStorage.setItem('sikka_fleet_user', JSON.stringify(data.user));
          })
          .catch((err) => {
            if (err.status === 401) {
              handleAuthExpired();
              router.push('/login?expired=1');
            }
          });
      } catch {
        handleAuthExpired();
      }
    }
    setIsLoading(false);

    return () => {
      window.removeEventListener('sikka:auth-expired', handleAuthExpired);
    };
  }, [router]);

  const login = async (
    username: string,
    password: string,
    loginType: 'User' | 'Driver' = 'User',
    location?: { latitude: number; longitude: number; accuracy?: number | null }
  ) => {
    const data = await apiRequest<{
      token: string;
      user: UserProfile;
    }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password, loginType, location }),
    });

    setToken(data.token);
    setUser(data.user);
    localStorage.setItem('sikka_fleet_token', data.token);
    localStorage.setItem('sikka_fleet_user', JSON.stringify(data.user));
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('sikka_fleet_token');
    localStorage.removeItem('sikka_fleet_user');
    router.push('/login');
  };

  const refreshUser = async () => {
    try {
      const data = await apiRequest<{ user: UserProfile }>('/auth/me');
      setUser(data.user);
      localStorage.setItem('sikka_fleet_user', JSON.stringify(data.user));
    } catch {
      // ignore
    }
  };

  const hasPageAccess = (pageName: string): boolean => {
    if (!user) return false;
    // Requirement 12: Driver has strictly Dashboard-only access
    if (user.role === 'Driver') return pageName === 'Dashboard';
    if (user.role === 'Admin') return true;
    return Array.isArray(user.accessPages) && user.accessPages.includes(pageName);
  };

  const hasPlantAccess = (plantId: string): boolean => {
    if (!user) return false;
    if (user.role === 'Admin') return true;
    if (!user.accessPlants || user.accessPlants.length === 0) return true;

    return user.accessPlants.some((p) => {
      const pid = typeof p === 'string' ? p : p._id;
      return pid === plantId;
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

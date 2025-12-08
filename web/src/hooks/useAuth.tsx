import { useState, useEffect, createContext, useContext, ReactNode } from 'react';
import { User } from '../types';
import { authApi } from '../api/auth';
import { tokenStorage } from '../api/client';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (data: {
    email: string;
    password: string;
    name: string;
    specialization: string;
    clinicName: string;
    country: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    const token = tokenStorage.get();
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }

    try {
      const response = await authApi.getMe();
      setUser(response.user);
    } catch (error) {
      // Token is invalid, clear it
      tokenStorage.remove();
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  const login = async (email: string, password: string) => {
    console.log('[useAuth] Login attempt for:', email);
    const response = await authApi.login({ email, password });
    console.log('[useAuth] Login response received');
    console.log('[useAuth] Response has token:', !!response.token);
    if (response.token) {
      console.log('[useAuth] Token length:', response.token.length);
      console.log('[useAuth] Token preview:', response.token.substring(0, 20) + '...' + response.token.substring(response.token.length - 20));
      tokenStorage.set(response.token);
      const storedToken = tokenStorage.get();
      console.log('[useAuth] Token stored in localStorage:', storedToken ? `present (length: ${storedToken.length})` : 'missing');
      console.log('[useAuth] Stored token matches received:', storedToken === response.token);
    } else {
      console.error('[useAuth] No token in login response!');
    }
    setUser(response.user);
  };

  const signup = async (data: {
    email: string;
    password: string;
    name: string;
    specialization: string;
    clinicName: string;
    country: string;
  }) => {
    const response = await authApi.signup(data);
    if (response.token) {
      tokenStorage.set(response.token);
    }
    setUser(response.user);
  };

  const logout = async () => {
    try {
      await authApi.logout();
    } catch (error) {
      // Continue with logout even if API call fails
    } finally {
      tokenStorage.remove();
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};




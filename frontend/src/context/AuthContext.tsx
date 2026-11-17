import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, setSessionExpiredHandler, tokens, type SystemStatus } from '../services/api';
import { disconnectSocket } from '../services/socket';
import type { Role, User } from '../types';

interface AuthState {
  user: User | null;
  loading: boolean;
  system: SystemStatus | null;
  systemError: boolean;
  login: (email: string, password: string) => Promise<User>;
  demoLogin: (role: Role) => Promise<User>;
  logout: () => Promise<void>;
  refreshSystem: () => void;
}

const AuthContext = createContext<AuthState | null>(null);
const USER_KEY = 'lotflow-user';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw && tokens.access ? (JSON.parse(raw) as User) : null;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(Boolean(tokens.access));
  const [system, setSystem] = useState<SystemStatus | null>(null);
  const [systemError, setSystemError] = useState(false);

  const refreshSystem = useCallback(() => {
    api
      .health()
      .then((s) => {
        setSystem(s);
        setSystemError(false);
      })
      .catch(() => setSystemError(true));
  }, []);

  useEffect(() => {
    refreshSystem();
    setSessionExpiredHandler(() => {
      localStorage.removeItem(USER_KEY);
      setUser(null);
      disconnectSocket();
    });
    if (!tokens.access) return;
    api
      .me()
      .then(({ user: u }) => {
        setUser(u);
        localStorage.setItem(USER_KEY, JSON.stringify(u));
      })
      .catch(() => {
        // If the server is unreachable keep the cached user; 401s are handled by the interceptor.
      })
      .finally(() => setLoading(false));
  }, [refreshSystem]);

  const accept = (data: { user: User; accessToken: string; refreshToken: string }) => {
    disconnectSocket();
    tokens.set(data.accessToken, data.refreshToken);
    localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    setUser(data.user);
    return data.user;
  };

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      system,
      systemError,
      refreshSystem,
      login: async (email, password) => accept(await api.login(email, password)),
      demoLogin: async (role) => accept(await api.demoLogin(role)),
      logout: async () => {
        try {
          await api.logout();
        } catch {
          /* ignore */
        }
        tokens.clear();
        localStorage.removeItem(USER_KEY);
        disconnectSocket();
        setUser(null);
      },
    }),
    [user, loading, system, systemError, refreshSystem],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

export const HOME_FOR_ROLE: Record<Role, string> = {
  MANAGER: '/dashboard',
  LOT_ASSOCIATE: '/voice',
  SERVICE_ADVISOR: '/service',
};

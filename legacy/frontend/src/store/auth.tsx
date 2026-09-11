import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { get, post, setTokens, getTokens, onAuthChange } from '@/api/client';
import type { Staff, Tokens, User } from '@/api/types';

interface AuthState {
  user: User | null;
  staffProfile: Staff | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (data: { email: string; password: string; firstName: string; lastName: string; phone?: string }) => Promise<User>;
  logout: () => void;
  refreshMe: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [staffProfile, setStaffProfile] = useState<Staff | null>(null);
  const [loading, setLoading] = useState(!!getTokens());

  const refreshMe = useCallback(async () => {
    if (!getTokens()) { setUser(null); setStaffProfile(null); setLoading(false); return; }
    try {
      const me = await get<{ user: User; staffProfile: Staff | null }>('/auth/me');
      setUser(me.user); setStaffProfile(me.staffProfile);
    } catch { setTokens(null); setUser(null); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void refreshMe(); }, [refreshMe]);
  useEffect(() => onAuthChange(() => { if (!getTokens()) { setUser(null); setStaffProfile(null); } }), []);

  const login = useCallback(async (email: string, password: string) => {
    const r = await post<{ user: User; tokens: Tokens }>('/auth/login', { email, password });
    setTokens(r.tokens); setUser(r.user);
    await refreshMe();
    return r.user;
  }, [refreshMe]);

  const register = useCallback(async (data: { email: string; password: string; firstName: string; lastName: string; phone?: string }) => {
    const r = await post<{ user: User; tokens: Tokens }>('/auth/register', data);
    setTokens(r.tokens); setUser(r.user); setStaffProfile(null);
    return r.user;
  }, []);

  const logout = useCallback(() => { setTokens(null); setUser(null); setStaffProfile(null); }, []);

  const value = useMemo(() => ({ user, staffProfile, loading, login, register, logout, refreshMe }), [user, staffProfile, loading, login, register, logout, refreshMe]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth fuera de AuthProvider');
  return v;
};

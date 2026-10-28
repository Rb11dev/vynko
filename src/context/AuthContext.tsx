'use client';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { get, post, ApiError } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import type { Me } from '@/lib/types';

type AuthCtx = { user: Me | null; loading: boolean; setUser: (u: Me | null) => void; refresh: () => Promise<void>; logout: () => Promise<void> };
const Ctx = createContext<AuthCtx | null>(null);
export const useAuth = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth must be used inside AuthProvider');
  return c;
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try { setUser((await get<{ user: Me }>('/api/me')).user); }
    catch (e) { if (!(e instanceof ApiError) || e.status === 401) setUser(null); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const logout = useCallback(async () => {
    try { await post('/api/auth/logout'); } catch { /* cookie is cleared server-side if reachable */ }
    getSocket().disconnect();
    setUser(null);
  }, []);

  return <Ctx.Provider value={{ user, loading, setUser, refresh, logout }}>{children}</Ctx.Provider>;
}

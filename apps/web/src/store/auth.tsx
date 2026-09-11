import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PermissionSet, type AuthResult, type Session } from '@erp/contracts';
import {
  get,
  getOrganizationId,
  getTokens,
  onAuthChange,
  post,
  setOrganizationId,
  setTokens,
} from '@/lib/api/client';

interface AuthState {
  session: Session | null;
  permissions: PermissionSet;
  loading: boolean;
  login(email: string, password: string): Promise<void>;
  register(input: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    organizationName?: string;
    invitationToken?: string;
  }): Promise<void>;
  logout(): Promise<void>;
  switchOrganization(organizationId: string): Promise<void>;
  refreshSession(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);
const SESSION_KEY = ['/auth/session'] as const;

/**
 * Sesión del usuario.
 *
 * Se modela como una consulta de TanStack Query, no como `useState` +
 * `useEffect`: el estado del servidor pertenece a la caché de consultas. Así
 * desaparece el efecto que sincronizaba a mano (y que provocaba renders en
 * cascada), y cualquier parte de la app puede invalidar la sesión —por ejemplo
 * tras cambiar los permisos de un rol— sin pasar por este contexto.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: SESSION_KEY,
    // Sin token no hay nada que pedir; `enabled` evita un 401 en cada arranque.
    enabled: getTokens() !== null,
    queryFn: async () => {
      const session = await get<Session>('/auth/session');
      if (session.activeOrganizationId !== getOrganizationId()) {
        setOrganizationId(session.activeOrganizationId);
      }
      return session;
    },
    retry: false,
    staleTime: 5 * 60_000,
  });

  // El cliente HTTP avisa cuando la sesión muere (un refresco que falló): eso
  // es un sistema externo, que es justo para lo que sirve un efecto.
  useEffect(
    () =>
      onAuthChange(() => {
        if (!getTokens()) queryClient.setQueryData(SESSION_KEY, null);
      }),
    [queryClient],
  );

  const applyResult = useCallback(
    (result: AuthResult) => {
      setTokens(result.tokens);
      setOrganizationId(result.session.activeOrganizationId);
      queryClient.setQueryData(SESSION_KEY, result.session);
    },
    [queryClient],
  );

  const session = query.data ?? null;

  const value = useMemo<AuthState>(
    () => ({
      session,
      permissions: session ? PermissionSet.fromJSON(session.permissions) : PermissionSet.empty(),
      loading: query.isLoading,
      login: async (email, password) => {
        applyResult(await post<AuthResult>('/auth/login', { email, password }));
      },
      register: async (input) => {
        applyResult(await post<AuthResult>('/auth/register', input));
      },
      logout: async () => {
        const current = getTokens();
        if (current) {
          await post('/auth/logout', { refreshToken: current.refreshToken }).catch(() => undefined);
        }
        setTokens(null);
        setOrganizationId(null);
        queryClient.clear();
      },
      switchOrganization: async (organizationId) => {
        applyResult(await post<AuthResult>('/auth/switch-organization', { organizationId }));
        // Los datos en caché son de la otra empresa: no valen para esta.
        await queryClient.invalidateQueries();
      },
      refreshSession: async () => {
        await queryClient.invalidateQueries({ queryKey: SESSION_KEY });
      },
    }),
    [session, query.isLoading, applyResult, queryClient],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}

/** Organización activa, ya resuelta desde la lista de la sesión. */
export function useOrganization() {
  const { session } = useAuth();
  return session?.organizations.find((o) => o.id === session.activeOrganizationId) ?? null;
}

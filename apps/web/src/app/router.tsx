import { createBrowserRouter, Navigate, Outlet, type RouteObject } from 'react-router-dom';
import { PageLoader } from '@/design-system';
import { useAuth } from '@/store/auth';
import { AppShell } from './shell/AppShell';
import { features } from './features';
import { LoginPage } from '@/features/auth/pages/LoginPage';
import { RegisterPage } from '@/features/auth/pages/RegisterPage';

/** Exige sesión iniciada; si no la hay, manda al login conservando el destino. */
function RequireAuth() {
  const { session, loading } = useAuth();
  if (loading) return <PageLoader text="Comprobando tu sesión…" />;
  if (!session) {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return <Outlet />;
}

/** Quien ya tiene sesión no debería ver el login. */
function RequireAnonymous() {
  const { session, loading } = useAuth();
  if (loading) return <PageLoader />;
  if (session) return <Navigate to="/" replace />;
  return <Outlet />;
}

const featureRoutes: RouteObject[] = features.flatMap((f) => f.routes ?? []);

export const router = createBrowserRouter([
  {
    element: <RequireAnonymous />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/registro', element: <RegisterPage /> },
    ],
  },
  {
    element: <RequireAuth />,
    children: [{ element: <AppShell />, children: featureRoutes }],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);

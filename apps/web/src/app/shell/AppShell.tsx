import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Dialog, DialogContent, cx } from '@/design-system';
import { useAuth, useOrganization } from '@/store/auth';
import { useBrandHue } from '@/store/theme';
import { features } from '../features';
import { mergeNav } from '../nav';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { CommandPalette } from './CommandPalette';

const SIDEBAR_KEY = 'erp.sidebar.collapsed';

export function AppShell() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const organization = useOrganization();
  const { session } = useAuth();

  // Marca blanca: el matiz de la organización activa recolorea la aplicación.
  useBrandHue(organization?.brandHue);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_KEY, String(collapsed));
    } catch {
      /* almacenamiento bloqueado */
    }
  }, [collapsed]);

  const nav = mergeNav(features.flatMap((f) => f.nav ?? []));
  const commands = features.flatMap((f) => f.commands ?? []);

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <Topbar onToggleSidebar={() => setCollapsed((v) => !v)} onOpenMobileNav={() => setMobileOpen(true)} />

      <div className="flex min-h-0 flex-1">
        <aside
          className={cx(
            'hidden shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-200 md:flex',
            collapsed ? 'w-14' : 'w-60',
          )}
        >
          <Sidebar items={nav} collapsed={collapsed} />
          {!collapsed && (
            <div className="border-t border-border p-3 text-[11px] text-fg-subtle">
              <p className="truncate">{session?.roles.map((r) => r.name).join(' · ') || 'Sin rol'}</p>
            </div>
          )}
        </aside>

        <main className="min-w-0 flex-1">
          <div className="mx-auto max-w-[1600px] space-y-5 p-4 sm:p-6">
            <Outlet />
          </div>
        </main>
      </div>

      {/* En móvil la navegación es un diálogo a pantalla completa. */}
      <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
        <DialogContent title="Menú" size="sm">
          <Sidebar items={nav} collapsed={false} onNavigate={() => setMobileOpen(false)} />
        </DialogContent>
      </Dialog>

      <CommandPalette commands={commands} />
    </div>
  );
}

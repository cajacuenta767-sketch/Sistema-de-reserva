import { Link } from 'react-router-dom';
import {
  Bell,
  Building2,
  Check,
  LogOut,
  Menu,
  Monitor,
  Moon,
  PanelLeft,
  Search,
  Sun,
  User,
} from 'lucide-react';
import {
  Avatar,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  cx,
} from '@/design-system';
import { useAuth, useOrganization } from '@/store/auth';
import { useTheme, type ThemeChoice } from '@/store/theme';

const THEME_OPTIONS: Array<{ value: ThemeChoice; label: string; icon: typeof Sun }> = [
  { value: 'light', label: 'Claro', icon: Sun },
  { value: 'dark', label: 'Oscuro', icon: Moon },
  { value: 'system', label: 'Sistema', icon: Monitor },
];

interface TopbarProps {
  onToggleSidebar: () => void;
  onOpenMobileNav: () => void;
}

export function Topbar({ onToggleSidebar, onOpenMobileNav }: TopbarProps) {
  const { session, logout, switchOrganization } = useAuth();
  const organization = useOrganization();
  const { choice, setChoice } = useTheme();

  const user = session?.user;
  const organizations = session?.organizations ?? [];

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-surface px-3">
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        onClick={onOpenMobileNav}
        aria-label="Abrir menú"
      >
        <Menu className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="hidden md:inline-flex"
        onClick={onToggleSidebar}
        aria-label="Plegar o desplegar la barra lateral"
      >
        <PanelLeft className="size-4" />
      </Button>

      {/* Selector de organización: solo aparece si hay más de una. */}
      {organizations.length > 1 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" icon={<Building2 className="size-4" />} className="max-w-52">
              <span className="truncate">{organization?.tradeName ?? 'Elegir empresa'}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-60">
            <DropdownMenuLabel>Cambiar de empresa</DropdownMenuLabel>
            {organizations.map((org) => (
              <DropdownMenuItem key={org.id} onSelect={() => void switchOrganization(org.id)}>
                <span className="flex-1 truncate">{org.tradeName}</span>
                {org.id === session?.activeOrganizationId && <Check className="size-4 text-accent" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        organization && (
          <span className="max-w-52 truncate px-2 text-sm font-medium text-fg">{organization.tradeName}</span>
        )
      )}

      {/* Atajo de búsqueda: abre la misma paleta que ⌘K. */}
      <button
        type="button"
        onClick={() =>
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }))
        }
        className={cx(
          'ml-auto hidden items-center gap-2 rounded-[var(--radius-control)] border border-border',
          'bg-surface-2 px-2.5 py-1.5 text-xs text-fg-subtle transition-colors hover:text-fg-muted sm:flex',
        )}
      >
        <Search className="size-3.5" />
        Buscar
        <kbd className="rounded border border-border bg-surface px-1 py-0.5 font-mono text-[10px]">⌘K</kbd>
      </button>

      <div className="ml-auto flex items-center gap-1 sm:ml-0">
        <Button variant="ghost" size="icon" aria-label="Notificaciones" asChild>
          <Link to="/notificaciones">
            <Bell className="size-4" />
          </Link>
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
              aria-label="Menú de usuario"
            >
              <Avatar name={user?.fullName ?? '?'} src={user?.avatarUrl} size="sm" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-56">
            <div className="px-2 py-1.5">
              <p className="truncate text-sm font-medium text-fg">{user?.fullName}</p>
              <p className="truncate text-xs text-fg-subtle">{user?.email}</p>
            </div>
            <DropdownMenuSeparator />

            <DropdownMenuItem asChild>
              <Link to="/perfil">
                <User className="size-4" />
                Mi perfil
              </Link>
            </DropdownMenuItem>

            <DropdownMenuSeparator />
            <DropdownMenuLabel>Tema</DropdownMenuLabel>
            {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
              <DropdownMenuItem key={value} onSelect={() => setChoice(value)}>
                <Icon className="size-4" />
                <span className="flex-1">{label}</span>
                {choice === value && <Check className="size-4 text-accent" />}
              </DropdownMenuItem>
            ))}

            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={() => void logout()}>
              <LogOut className="size-4" />
              Cerrar sesión
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

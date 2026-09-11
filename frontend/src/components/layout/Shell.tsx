import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Bell, CalendarCheck2, LogOut, Menu, Sparkles, UserRound, X, LayoutDashboard, ClipboardList } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAuth } from '@/store/auth';
import { get } from '@/api/client';
import { cx } from '@/components/ui';

export function Shell() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) { setUnread(0); return; }
    let alive = true;
    const load = () => get<{ unread: number }>('/notifications', { unreadOnly: true }).then((r) => alive && setUnread(r.unread)).catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(t); };
  }, [user]);

  const links = [
    { to: '/reservar', label: 'Reservar', show: true },
    { to: '/mis-reservas', label: 'Mis reservas', show: !!user && user.role === 'CLIENT' },
    { to: '/staff/agenda', label: 'Mi agenda', show: user?.role === 'STAFF' },
    { to: '/admin', label: 'Panel', show: user?.role === 'ADMIN' },
    { to: '/seguimiento', label: 'Seguir reserva', show: !user },
  ].filter((l) => l.show);

  const navClass = ({ isActive }: { isActive: boolean }) =>
    cx('rounded-full px-4 py-2 text-sm font-semibold transition', isActive ? 'bg-brand-600 text-white shadow-lift' : 'text-ink-700 hover:bg-sand-100');

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-50 border-b border-ink-900/5 bg-sand-50/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link to="/" className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-lift"><CalendarCheck2 className="h-5 w-5" /></span>
            <span className="font-display text-xl font-bold tracking-tight">Reserva<span className="text-brand-600">Flow</span></span>
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {links.map((l) => <NavLink key={l.to} to={l.to} className={navClass}>{l.label}</NavLink>)}
          </nav>
          <div className="flex items-center gap-2">
            {user ? (
              <>
                <Link to="/notificaciones" className="relative rounded-full p-2 text-ink-700 hover:bg-sand-100" aria-label="Notificaciones">
                  <Bell className="h-5 w-5" />
                  {unread > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-coral-500 px-1 text-[10px] font-bold text-white">{unread > 9 ? '9+' : unread}</span>}
                </Link>
                <Link to="/perfil" className="hidden items-center gap-2 rounded-full py-1 pl-1 pr-3 text-sm font-semibold hover:bg-sand-100 md:flex">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-800">{user.firstName[0]}{user.lastName[0]}</span>
                  {user.firstName}
                </Link>
                <button onClick={() => { logout(); navigate('/'); }} className="hidden rounded-full p-2 text-ink-500 hover:bg-sand-100 md:block" aria-label="Cerrar sesión"><LogOut className="h-5 w-5" /></button>
              </>
            ) : (
              <>
                <Link to="/login" className="btn-ghost hidden md:inline-flex">Entrar</Link>
                <Link to="/registro" className="btn-primary hidden md:inline-flex">Crear cuenta</Link>
              </>
            )}
            <button onClick={() => setOpen((o) => !o)} className="rounded-full p-2 hover:bg-sand-100 md:hidden" aria-label="Menú">{open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}</button>
          </div>
        </div>
        {open && (
          <div className="border-t border-ink-900/5 bg-white px-4 py-3 md:hidden animate-fade-up">
            <div className="flex flex-col gap-1">
              {links.map((l) => <NavLink key={l.to} to={l.to} onClick={() => setOpen(false)} className={navClass}>{l.label}</NavLink>)}
              {user ? (
                <>
                  <NavLink to="/perfil" onClick={() => setOpen(false)} className={navClass}><UserRound className="mr-2 inline h-4 w-4" />Mi perfil</NavLink>
                  <button onClick={() => { logout(); setOpen(false); navigate('/'); }} className="rounded-full px-4 py-2 text-left text-sm font-semibold text-coral-600 hover:bg-sand-100">Cerrar sesión</button>
                </>
              ) : (
                <>
                  <NavLink to="/login" onClick={() => setOpen(false)} className={navClass}>Entrar</NavLink>
                  <NavLink to="/registro" onClick={() => setOpen(false)} className={navClass}>Crear cuenta</NavLink>
                </>
              )}
            </div>
          </div>
        )}
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
        <Outlet />
      </main>
      <footer className="border-t border-ink-900/5 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 text-xs text-ink-500 sm:flex-row sm:px-6">
          <span className="flex items-center gap-1"><Sparkles className="h-3.5 w-3.5 text-brand-600" /> ReservaFlow · Sistema de reservas</span>
          <span className="flex gap-4">
            <Link to="/reservar" className="hover:text-ink-900"><ClipboardList className="mr-1 inline h-3.5 w-3.5" />Reservar</Link>
            <Link to="/seguimiento" className="hover:text-ink-900"><LayoutDashboard className="mr-1 inline h-3.5 w-3.5" />Seguir una reserva</Link>
          </span>
        </div>
      </footer>
    </div>
  );
}

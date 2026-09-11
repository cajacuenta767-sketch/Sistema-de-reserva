import { NavLink, Outlet } from 'react-router-dom';
import { BarChart3, CalendarRange, Layers, Ticket, Users } from 'lucide-react';
import { cx } from '@/components/ui';

const items = [
  { to: '/admin', label: 'Resumen', icon: BarChart3, end: true },
  { to: '/admin/reservas', label: 'Reservas', icon: CalendarRange },
  { to: '/admin/servicios', label: 'Servicios', icon: Layers },
  { to: '/admin/personal', label: 'Personal', icon: Users },
  { to: '/admin/cupones', label: 'Cupones', icon: Ticket },
];

export function AdminLayout() {
  return (
    <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
      <nav className="flex gap-1 overflow-x-auto scrollbar-thin lg:flex-col">
        {items.map((i) => (
          <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => cx('flex shrink-0 items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold transition', isActive ? 'bg-brand-600 text-white shadow-lift' : 'text-ink-700 hover:bg-sand-100')}>
            <i.icon className="h-4 w-4" /> {i.label}
          </NavLink>
        ))}
      </nav>
      <div className="min-w-0 animate-fade-up"><Outlet /></div>
    </div>
  );
}

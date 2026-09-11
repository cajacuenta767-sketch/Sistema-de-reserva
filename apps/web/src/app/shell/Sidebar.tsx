import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { cx } from '@/design-system';
import { useCan } from '@/lib/authz/useCan';
import type { NavItem } from '../types';

/**
 * Barra lateral generada desde el registro de módulos y filtrada por permisos:
 * un usuario sin acceso a contabilidad no ve la entrada, no la ve deshabilitada.
 * Enseñar puertas cerradas solo genera preguntas a soporte.
 */

interface SidebarProps {
  items: NavItem[];
  collapsed: boolean;
  onNavigate?: () => void;
}

export function Sidebar({ items, collapsed, onNavigate }: SidebarProps) {
  const can = useCan();

  const visible = (list: NavItem[]): NavItem[] =>
    list
      .filter((item) => !item.permission || can(item.permission))
      .map((item) => (item.children ? { ...item, children: visible(item.children) } : item))
      .filter((item) => !item.children || item.children.length > 0 || item.to);

  return (
    <nav className="flex-1 space-y-0.5 overflow-y-auto p-2" aria-label="Navegación principal">
      {visible(items).map((item) => (
        <SidebarEntry key={item.label} item={item} collapsed={collapsed} onNavigate={onNavigate} />
      ))}
    </nav>
  );
}

function SidebarEntry({
  item,
  collapsed,
  onNavigate,
}: {
  item: NavItem;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const location = useLocation();
  const hasChildren = Boolean(item.children?.length);
  const childActive = item.children?.some((c) => c.to && location.pathname.startsWith(c.to)) ?? false;
  const [open, setOpen] = useState(childActive);
  const Icon = item.icon;
  const badge = item.badge?.();

  const base = cx(
    'group flex w-full items-center gap-2.5 rounded-[var(--radius-control)] px-2.5 py-2 text-sm',
    'transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]',
  );

  if (hasChildren) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className={cx(base, childActive ? 'text-fg' : 'text-fg-muted hover:bg-surface-2 hover:text-fg')}
          title={collapsed ? item.label : undefined}
        >
          {Icon && <Icon className="size-4 shrink-0" />}
          {!collapsed && (
            <>
              <span className="flex-1 truncate text-left">{item.label}</span>
              <ChevronDown className={cx('size-3.5 transition-transform', open && 'rotate-180')} />
            </>
          )}
        </button>

        {open && !collapsed && (
          <div className="mt-0.5 ml-4 space-y-0.5 border-l border-border pl-2">
            {item.children?.map((child) => (
              <SidebarEntry key={child.label} item={child} collapsed={false} onNavigate={onNavigate} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <NavLink
      to={item.to ?? '#'}
      end={item.to === '/'}
      onClick={onNavigate}
      title={collapsed ? item.label : undefined}
      className={({ isActive }) =>
        cx(
          base,
          isActive
            ? 'bg-accent text-fg-on-accent shadow-sm'
            : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
        )
      }
    >
      {Icon && <Icon className="size-4 shrink-0" />}
      {!collapsed && (
        <>
          <span className="flex-1 truncate">{item.label}</span>
          {badge !== undefined && badge > 0 && (
            <span className="tabular rounded-full bg-danger px-1.5 py-0.5 text-[10px] font-medium text-fg-on-accent">
              {badge > 99 ? '99+' : badge}
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}

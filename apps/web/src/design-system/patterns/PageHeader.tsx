import type { ReactNode } from 'react';
import { cx } from '../primitives/cx.js';

export interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  tabs?: ReactNode;
  className?: string;
}

export function PageHeader({ title, description, actions, tabs, className }: PageHeaderProps) {
  return (
    <div className={cx('space-y-4', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-0.5">
          <h1 className="page-title">{title}</h1>
          {description && <p className="text-sm text-fg-muted">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {tabs}
    </div>
  );
}

export interface StatTileProps {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
  tone?: 'accent' | 'success' | 'warning' | 'danger' | 'info';
  onClick?: () => void;
}

const ICON_TONES = {
  accent: 'bg-accent-soft text-accent-soft-fg',
  success: 'bg-success-soft text-success-fg',
  warning: 'bg-warning-soft text-warning-fg',
  danger: 'bg-danger-soft text-danger-fg',
  info: 'bg-info-soft text-info-fg',
};

/**
 * Tarjeta de indicador del Escritorio. Icono de color a la izquierda y cifra a
 * la derecha, como en las capturas de referencia; en móvil la fila se mantiene
 * porque apilar el icono sobre la cifra desperdicia la altura, que es el recurso
 * escaso en un teléfono.
 */
export function StatTile({ label, value, hint, icon, tone = 'accent', onClick }: StatTileProps) {
  const Component = onClick ? 'button' : 'div';
  return (
    <Component
      {...(onClick ? { onClick, type: 'button' as const } : {})}
      className={cx(
        'card flex items-center gap-3 p-4 text-left',
        onClick && 'transition-colors hover:bg-surface-2',
      )}
    >
      {icon && (
        <span
          className={cx('flex size-10 shrink-0 items-center justify-center rounded-lg', ICON_TONES[tone])}
          aria-hidden
        >
          {icon}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs text-fg-muted">{label}</p>
        <p className="tabular truncate text-xl font-semibold text-fg">{value}</p>
        {hint && <p className="truncate text-xs text-fg-subtle">{hint}</p>}
      </div>
    </Component>
  );
}

export interface ProgressCardProps {
  label: string;
  value: number;
  total: number;
  tone?: 'accent' | 'success' | 'warning' | 'danger' | 'info';
  formatValue?: (v: number) => string;
}

const BARS = {
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
};

/** Contador con su porcentaje del total, como en la vista general de clientes. */
export function ProgressCard({ label, value, total, tone = 'accent', formatValue }: ProgressCardProps) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="card space-y-2 p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-fg">{label}</p>
        <p className="tabular text-xl font-semibold text-fg">{formatValue ? formatValue(value) : value}</p>
      </div>
      <p className="text-xs text-fg-subtle">{pct}% del total</p>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-surface-3"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          className={cx('h-full rounded-full transition-[width]', BARS[tone])}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

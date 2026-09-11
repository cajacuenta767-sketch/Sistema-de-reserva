import type { ReactNode } from 'react';
import { cx } from './cx.js';

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

const TONES: Record<Tone, string> = {
  neutral: 'bg-neutral-soft text-neutral-fg',
  accent: 'bg-accent-soft text-accent-soft-fg',
  success: 'bg-success-soft text-success-fg',
  warning: 'bg-warning-soft text-warning-fg',
  danger: 'bg-danger-soft text-danger-fg',
  info: 'bg-info-soft text-info-fg',
};

const DOTS: Record<Tone, string> = {
  neutral: 'bg-neutral',
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
};

export interface BadgeProps {
  children: ReactNode;
  tone?: Tone;
  /** Punto de color: distingue estados sin depender solo del color de fondo,
   *  que es lo que falla con daltonismo y en impresión en blanco y negro. */
  dot?: boolean;
  className?: string;
}

export function Badge({ children, tone = 'neutral', dot, className }: BadgeProps) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        TONES[tone],
        className,
      )}
    >
      {dot && <span className={cx('size-1.5 shrink-0 rounded-full', DOTS[tone])} aria-hidden />}
      {children}
    </span>
  );
}

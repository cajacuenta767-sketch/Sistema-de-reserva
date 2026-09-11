import { Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from './cx.js';

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('size-4 animate-spin text-accent', className)} aria-label="Cargando" />;
}

export function PageLoader({ text = 'Cargando…' }: { text?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20 text-fg-muted" role="status">
      <Spinner className="size-6" />
      <span className="text-sm">{text}</span>
    </div>
  );
}

/**
 * Esqueleto de carga. Reserva el espacio EXACTO del contenido real: un esqueleto
 * de otro tamaño provoca un salto de layout al llegar los datos, que molesta más
 * que un spinner.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded bg-surface-3', className)} aria-hidden />;
}

export interface EmptyProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function Empty({ icon, title, description, action, className }: EmptyProps) {
  return (
    <div className={cx('flex flex-col items-center gap-3 px-6 py-14 text-center', className)}>
      {icon && (
        <div className="flex size-11 items-center justify-center rounded-full bg-surface-2 text-fg-subtle">
          {icon}
        </div>
      )}
      <div className="space-y-1">
        <p className="font-medium text-fg">{title}</p>
        {description && <p className="mx-auto max-w-sm text-sm text-fg-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({
  title = 'Algo salió mal',
  description,
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center" role="alert">
      <p className="font-medium text-danger-fg">{title}</p>
      {description && <p className="max-w-md text-sm text-fg-muted">{description}</p>}
      {action}
    </div>
  );
}

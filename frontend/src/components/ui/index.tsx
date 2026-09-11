import { Star, Loader2, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export function Spinner({ className = '' }: { className?: string }) {
  return <Loader2 className={cx('h-5 w-5 animate-spin text-brand-600', className)} aria-label="Cargando" />;
}

export function PageLoader({ text = 'Cargando…' }: { text?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-ink-500">
      <Spinner className="h-8 w-8" />
      <span className="text-sm">{text}</span>
    </div>
  );
}

export function Stars({ value, size = 'md', count }: { value: number; size?: 'sm' | 'md' | 'lg'; count?: number }) {
  const sz = { sm: 'h-3.5 w-3.5', md: 'h-4 w-4', lg: 'h-5 w-5' }[size];
  return (
    <span className="inline-flex items-center gap-1" aria-label={`${value} de 5 estrellas`}>
      <span className="flex">
        {[1, 2, 3, 4, 5].map((i) => (
          <Star key={i} className={cx(sz, i <= Math.round(value) ? 'fill-amber-400 text-amber-400' : 'fill-sand-200 text-sand-300')} />
        ))}
      </span>
      <span className="text-sm font-semibold text-ink-900">{value ? value.toFixed(1) : '—'}</span>
      {count !== undefined && <span className="text-xs text-ink-500">({count} {count === 1 ? 'reseña' : 'reseñas'})</span>}
    </span>
  );
}

export function StarPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((i) => (
        <button key={i} type="button" onClick={() => onChange(i)} className="transition hover:scale-110" aria-label={`${i} estrellas`}>
          <Star className={cx('h-8 w-8', i <= value ? 'fill-amber-400 text-amber-400' : 'fill-sand-200 text-sand-300')} />
        </button>
      ))}
    </div>
  );
}

export function Avatar({ src, name, size = 'md', className = '' }: { src?: string | null; name: string; size?: 'sm' | 'md' | 'lg' | 'xl'; className?: string }) {
  const sz = { sm: 'h-8 w-8 text-xs', md: 'h-11 w-11 text-sm', lg: 'h-16 w-16 text-lg', xl: 'h-24 w-24 text-2xl' }[size];
  const [failed, setFailed] = useState(false);
  const initials = name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  return src && !failed ? (
    <img src={src} alt={name} onError={() => setFailed(true)} className={cx('shrink-0 rounded-full object-cover ring-2 ring-white', sz, className)} loading="lazy" />
  ) : (
    <div className={cx('flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-200 to-brand-400 font-bold text-brand-900 ring-2 ring-white', sz, className)} aria-label={name}>{initials}</div>
  );
}

/** Imagen con degradado de respaldo si la URL falla (o no hay URL). */
export function Picture({ src, alt = '', className = '' }: { src?: string | null; alt?: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <div className={cx('h-full w-full bg-gradient-to-br from-brand-100 via-sand-100 to-coral-100', className)} aria-hidden />;
  return <img src={src} alt={alt} onError={() => setFailed(true)} className={cx('h-full w-full object-cover', className)} loading="lazy" />;
}

export function Badge({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={cx('chip', className)}>{children}</span>;
}

export function Empty({ icon, title, text, action }: { icon?: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-3 px-6 py-14 text-center">
      {icon && <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">{icon}</div>}
      <h3 className="text-lg font-semibold">{title}</h3>
      {text && <p className="max-w-sm text-sm text-ink-500">{text}</p>}
      {action}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-ink-900/40 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div className={cx('card max-h-[92vh] w-full overflow-y-auto rounded-b-none p-6 animate-fade-up sm:rounded-3xl', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-xl font-semibold">{title}</h3>
          <button onClick={onClose} className="rounded-full p-1 text-ink-500 hover:bg-sand-100" aria-label="Cerrar"><X className="h-5 w-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-500">{hint}</span>}
    </label>
  );
}

export function StatTile({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: 'brand' | 'coral' | 'amber' | 'sky' }) {
  const colors = { brand: 'from-brand-500 to-brand-700', coral: 'from-coral-400 to-coral-600', amber: 'from-amber-400 to-amber-600', sky: 'from-sky-400 to-sky-600' };
  return (
    <div className="card relative overflow-hidden p-5">
      <div className={cx('absolute -right-6 -top-6 h-20 w-20 rounded-full bg-gradient-to-br opacity-15', colors[accent ?? 'brand'])} />
      <p className="text-xs font-semibold uppercase tracking-wider text-ink-500">{label}</p>
      <p className="mt-2 font-display text-3xl font-bold">{value}</p>
      {sub && <p className="mt-1 text-xs text-ink-500">{sub}</p>}
    </div>
  );
}

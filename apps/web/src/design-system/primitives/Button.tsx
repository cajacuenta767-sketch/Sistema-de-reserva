import { Slot, Slottable } from '@radix-ui/react-slot';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cx } from './cx.js';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-fg-on-accent hover:bg-accent-hover shadow-sm',
  secondary: 'bg-surface text-fg border border-border hover:bg-surface-2 shadow-sm',
  ghost: 'text-fg-muted hover:bg-surface-2 hover:text-fg',
  subtle: 'bg-accent-soft text-accent-soft-fg hover:brightness-95',
  danger: 'bg-danger text-fg-on-accent hover:brightness-110 shadow-sm',
  link: 'text-accent underline-offset-4 hover:underline',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-2.5 text-xs gap-1.5',
  md: 'h-9 px-3.5 text-sm gap-2',
  lg: 'h-11 px-5 text-sm gap-2',
  icon: 'h-9 w-9',
  'icon-sm': 'h-7 w-7',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  /** Renderiza el hijo en vez de un `<button>`: útil para enlaces con aspecto de botón. */
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'secondary', size = 'md', loading, icon, asChild, children, disabled, ...props },
  ref,
) {
  const Component = asChild ? Slot : 'button';
  return (
    <Component
      ref={ref}
      // `aria-busy` además de deshabilitar: un lector de pantalla debe saber que
      // la acción está en curso, no que el botón dejó de existir.
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-[var(--radius-control)] font-medium',
        'transition-colors duration-150 outline-none',
        'focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-1',
        'focus-visible:ring-offset-[var(--color-canvas)]',
        'disabled:pointer-events-none disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {/* `Slottable` marca cuál de los hijos recibe las props cuando `asChild`
          está activo. Sin él, Radix ve dos hijos (icono + contenido) y lanza
          "Slot failed to slot onto its children". */}
      <Slottable>{children}</Slottable>
    </Component>
  );
});

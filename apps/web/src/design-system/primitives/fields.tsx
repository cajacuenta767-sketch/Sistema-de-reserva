import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cx } from './cx.js';

const CONTROL =
  'w-full rounded-[var(--radius-control)] border border-border bg-surface px-3 text-sm text-fg ' +
  'placeholder:text-fg-subtle transition-colors outline-none ' +
  'focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] ' +
  'disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-fg-subtle ' +
  'aria-[invalid=true]:border-danger aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-danger-soft';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cx(CONTROL, 'h-9', className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea ref={ref} className={cx(CONTROL, 'min-h-20 py-2 leading-relaxed', className)} {...props} />
    );
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...props },
  ref,
) {
  return (
    <select ref={ref} className={cx(CONTROL, 'h-9 pr-8', className)} {...props}>
      {children}
    </select>
  );
});

export interface FieldProps {
  label: string;
  hint?: string;
  error?: string | undefined;
  required?: boolean;
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode;
  className?: string;
}

/**
 * Campo de formulario con etiqueta, ayuda y error correctamente enlazados.
 *
 * El `children` es una función porque los identificadores tienen que llegar al
 * control real: sin `aria-describedby` un lector de pantalla anuncia el campo
 * pero no el motivo del error, que es justo lo que el usuario necesita oír.
 */
export function Field({ label, hint, error, required, children, className }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cx('space-y-1', className)}>
      <label htmlFor={id} className="label">
        {label}
        {required && (
          <span className="ml-0.5 text-danger" aria-hidden>
            *
          </span>
        )}
      </label>
      {children({
        id,
        ...(describedBy ? { 'aria-describedby': describedBy } : {}),
        ...(error ? { 'aria-invalid': true } : {}),
      })}
      {error ? (
        <p id={errorId} className="text-xs text-danger-fg">
          {error}
        </p>
      ) : (
        hint && (
          <p id={hintId} className="text-xs text-fg-subtle">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

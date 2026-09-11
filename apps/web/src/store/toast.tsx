import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { cx } from '@/design-system';

type ToastTone = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
  /** Identificador de petición, para que el usuario pueda reportarlo. */
  requestId?: string;
}

interface ToastState {
  show(message: string, tone?: ToastTone, requestId?: string): void;
  success(message: string): void;
  error(error: unknown): void;
}

const ToastContext = createContext<ToastState | null>(null);

const ICONS = { success: CheckCircle2, error: AlertCircle, info: Info };
const TONES = {
  success: 'border-success bg-success-soft text-success-fg',
  error: 'border-danger bg-danger-soft text-danger-fg',
  info: 'border-info bg-info-soft text-info-fg',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (message: string, tone: ToastTone = 'info', requestId?: string) => {
      const id = Date.now() + Math.random();
      setToasts((prev) => [...prev, { id, tone, message, ...(requestId ? { requestId } : {}) }]);
      // Los errores duran más: hay que darles tiempo a leerse y anotar el código.
      setTimeout(() => dismiss(id), tone === 'error' ? 8000 : 4000);
    },
    [dismiss],
  );

  const value = useMemo<ToastState>(
    () => ({
      show,
      success: (message) => show(message, 'success'),
      error: (error) => {
        const message = error instanceof Error ? error.message : 'Ha ocurrido un error inesperado';
        const requestId =
          typeof error === 'object' && error !== null && 'requestId' in error
            ? String((error as { requestId?: string }).requestId ?? '')
            : undefined;
        show(message, 'error', requestId || undefined);
      },
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 p-4 sm:inset-x-auto sm:right-0 sm:items-end"
        role="region"
        aria-label="Notificaciones"
      >
        {toasts.map((toast) => {
          const Icon = ICONS[toast.tone];
          return (
            <div
              key={toast.id}
              role={toast.tone === 'error' ? 'alert' : 'status'}
              className={cx(
                'pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-[var(--radius-card)]',
                'border px-3 py-2.5 text-sm shadow-lg',
                'animate-[slide-up_180ms_cubic-bezier(0.22,1,0.36,1)]',
                TONES[toast.tone],
              )}
            >
              <Icon className="mt-0.5 size-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <p>{toast.message}</p>
                {toast.requestId && (
                  <p className="mt-0.5 font-mono text-[10px] opacity-70">#{toast.requestId.slice(0, 8)}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                className="shrink-0 rounded p-0.5 opacity-60 transition-opacity hover:opacity-100"
                aria-label="Cerrar"
              >
                <X className="size-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastState {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast debe usarse dentro de <ToastProvider>');
  return ctx;
}

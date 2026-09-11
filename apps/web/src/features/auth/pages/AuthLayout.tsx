import type { ReactNode } from 'react';

/**
 * Pantalla de acceso. El panel izquierdo desaparece por debajo de `lg`: en un
 * teléfono, el formulario tiene que empezar arriba del todo, no tras una
 * cabecera decorativa que obliga a desplazar antes de escribir.
 */
export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <aside className="relative hidden overflow-hidden bg-accent p-10 text-fg-on-accent lg:flex lg:flex-col lg:justify-between">
        <div
          className="absolute inset-0 opacity-25"
          style={{
            backgroundImage:
              'radial-gradient(circle at 20% 15%, var(--brand-300), transparent 45%),' +
              'radial-gradient(circle at 85% 80%, var(--brand-800), transparent 50%)',
          }}
          aria-hidden
        />
        <p className="relative text-lg font-semibold tracking-tight">Nexo ERP</p>
        <div className="relative space-y-3">
          <p className="max-w-sm text-2xl leading-snug font-medium">
            Clientes, ventas, compras y contabilidad en un solo sitio.
          </p>
          <p className="max-w-sm text-sm opacity-80">
            Con auditoría de cada cambio y cierre contable de verdad.
          </p>
        </div>
        <p className="relative text-xs opacity-70">Hecho para empresas colombianas</p>
      </aside>

      <main className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6">
          <div className="space-y-1.5">
            <h1 className="text-xl font-semibold tracking-tight text-fg">{title}</h1>
            {subtitle && <p className="text-sm text-fg-muted">{subtitle}</p>}
          </div>
          {children}
          {footer && <div className="text-center text-sm text-fg-muted">{footer}</div>}
        </div>
      </main>
    </div>
  );
}

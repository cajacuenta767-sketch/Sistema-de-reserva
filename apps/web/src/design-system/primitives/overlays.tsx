import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as DropdownPrimitive from '@radix-ui/react-dropdown-menu';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { X } from 'lucide-react';
import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { cx } from './cx.js';

/**
 * Overlays sobre Radix.
 *
 * Motivo de no hacerlos a mano: trampa de foco, restauración del foco al cerrar,
 * `aria-modal`, bloqueo del scroll, cierre con Escape y navegación con flechas
 * en los menús. Cada una de esas cosas se puede escribir mal de tres maneras, y
 * el resultado solo se nota cuando alguien intenta usar la app con teclado.
 */

const OVERLAY =
  'fixed inset-0 z-50 bg-overlay backdrop-blur-[2px] ' + 'data-[state=open]:animate-[fade-in_150ms_ease-out]';

const SURFACE = 'border border-border bg-surface text-fg shadow-lg';

// ── Diálogo ──────────────────────────────────────────────────────────────────

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export interface DialogContentProps extends ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  title: string;
  description?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  footer?: ReactNode;
}

const DIALOG_SIZES = { sm: 'sm:max-w-sm', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl' };

export const DialogContent = forwardRef<HTMLDivElement, DialogContentProps>(function DialogContent(
  { title, description, size = 'md', footer, children, className, ...props },
  ref,
) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={OVERLAY} />
      <DialogPrimitive.Content
        ref={ref}
        className={cx(
          'fixed z-50 flex flex-col gap-4 outline-none',
          // En móvil sube desde abajo ocupando el ancho; en escritorio se centra.
          'inset-x-0 bottom-0 max-h-[92vh] rounded-t-xl p-5',
          'sm:inset-auto sm:top-1/2 sm:left-1/2 sm:w-full sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl',
          'data-[state=open]:animate-[slide-up_180ms_cubic-bezier(0.22,1,0.36,1)]',
          SURFACE,
          DIALOG_SIZES[size],
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <DialogPrimitive.Title className="text-base font-semibold">{title}</DialogPrimitive.Title>
            {description && (
              <DialogPrimitive.Description className="text-sm text-fg-muted">
                {description}
              </DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close
            className="-mt-1 -mr-1 rounded p-1.5 text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg"
            aria-label="Cerrar"
          >
            <X className="size-4" />
          </DialogPrimitive.Close>
        </div>

        <div className="-mx-5 min-h-0 flex-1 overflow-y-auto px-5">{children}</div>

        {footer && <div className="flex justify-end gap-2 border-t border-border pt-4">{footer}</div>}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});

// ── Panel lateral ────────────────────────────────────────────────────────────

export interface DrawerContentProps extends ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  title: string;
  description?: string;
  width?: string;
  footer?: ReactNode;
}

/** Detalle rápido sin abandonar el listado: leer una factura desde la tabla. */
export const DrawerContent = forwardRef<HTMLDivElement, DrawerContentProps>(function DrawerContent(
  { title, description, width = 'sm:max-w-xl', footer, children, className, ...props },
  ref,
) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={OVERLAY} />
      <DialogPrimitive.Content
        ref={ref}
        className={cx(
          'fixed inset-y-0 right-0 z-50 flex w-full flex-col outline-none',
          'data-[state=open]:animate-[slide-in-right_200ms_cubic-bezier(0.22,1,0.36,1)]',
          SURFACE,
          width,
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border p-5">
          <div className="space-y-1">
            <DialogPrimitive.Title className="text-base font-semibold">{title}</DialogPrimitive.Title>
            {description && (
              <DialogPrimitive.Description className="text-sm text-fg-muted">
                {description}
              </DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close
            className="rounded p-1.5 text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg"
            aria-label="Cerrar"
          >
            <X className="size-4" />
          </DialogPrimitive.Close>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>

        {footer && <div className="flex justify-end gap-2 border-t border-border p-5">{footer}</div>}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});

// ── Menú desplegable ─────────────────────────────────────────────────────────

export const DropdownMenu = DropdownPrimitive.Root;
export const DropdownMenuTrigger = DropdownPrimitive.Trigger;

export const DropdownMenuContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof DropdownPrimitive.Content>
>(function DropdownMenuContent({ className, sideOffset = 6, ...props }, ref) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cx(
          'z-50 min-w-44 overflow-hidden rounded-[var(--radius-control)] p-1',
          'data-[state=open]:animate-[fade-in_120ms_ease-out]',
          SURFACE,
          className,
        )}
        {...props}
      />
    </DropdownPrimitive.Portal>
  );
});

export const DropdownMenuItem = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof DropdownPrimitive.Item> & { destructive?: boolean }
>(function DropdownMenuItem({ className, destructive, ...props }, ref) {
  return (
    <DropdownPrimitive.Item
      ref={ref}
      className={cx(
        'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm outline-none select-none',
        'data-[highlighted]:bg-surface-2',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        destructive ? 'text-danger-fg data-[highlighted]:bg-danger-soft' : 'text-fg',
        className,
      )}
      {...props}
    />
  );
});

export const DropdownMenuSeparator = () => <DropdownPrimitive.Separator className="my-1 h-px bg-border" />;

export const DropdownMenuLabel = ({ children }: { children: ReactNode }) => (
  <DropdownPrimitive.Label className="px-2 py-1.5 text-xs font-medium text-fg-subtle">
    {children}
  </DropdownPrimitive.Label>
);

export const DropdownMenuCheckboxItem = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof DropdownPrimitive.CheckboxItem>
>(function DropdownMenuCheckboxItem({ className, children, ...props }, ref) {
  return (
    <DropdownPrimitive.CheckboxItem
      ref={ref}
      className={cx(
        'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm outline-none select-none',
        'data-[highlighted]:bg-surface-2',
        className,
      )}
      {...props}
    >
      <span className="flex size-4 items-center justify-center rounded border border-border-strong">
        <DropdownPrimitive.ItemIndicator>
          <span className="size-2 rounded-[2px] bg-accent" />
        </DropdownPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownPrimitive.CheckboxItem>
  );
});

// ── Tooltip ──────────────────────────────────────────────────────────────────

export const TooltipProvider = TooltipPrimitive.Provider;

export function Tooltip({
  content,
  children,
  side = 'top',
}: {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
}) {
  if (!content) return <>{children}</>;
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className="z-50 max-w-xs rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-fg shadow-md"
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

// ── Popover ──────────────────────────────────────────────────────────────────

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;

export const PopoverContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(function PopoverContent({ className, sideOffset = 6, align = 'start', ...props }, ref) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        ref={ref}
        align={align}
        sideOffset={sideOffset}
        className={cx(
          'z-50 rounded-[var(--radius-control)] p-3 outline-none',
          'data-[state=open]:animate-[fade-in_120ms_ease-out]',
          SURFACE,
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
});

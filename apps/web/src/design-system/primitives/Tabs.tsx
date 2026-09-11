import * as TabsPrimitive from '@radix-ui/react-tabs';
import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { cx } from './cx.js';

/**
 * Pestañas.
 *
 * Sobre Radix y no sobre botones propios porque el teclado tiene reglas que casi
 * nadie reimplementa bien: flechas para moverse entre pestañas, Inicio y Fin
 * para ir a los extremos, y el foco saltando al panel con Tab. Hacerlo a mano
 * deja una navegación que funciona con ratón y no con teclado.
 *
 * El estado puede vivir en la URL (`value` + `onValueChange`), y en las fichas
 * conviene que así sea: compartir el enlace de una ficha abierta en "Historial"
 * tiene que abrirla en "Historial".
 */
export const Tabs = TabsPrimitive.Root;

export const TabsList = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(function TabsList({ className, ...props }, ref) {
  return (
    <TabsPrimitive.List
      ref={ref}
      className={cx(
        // Desplazable en horizontal: con seis pestañas en un móvil de 400 px no
        // caben, y envolverlas descoloca el resto de la ficha.
        'flex gap-1 overflow-x-auto border-b border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
      {...props}
    />
  );
});

export const TabsTrigger = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(function TabsTrigger({ className, ...props }, ref) {
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cx(
        'relative shrink-0 whitespace-nowrap px-3 py-2 text-sm font-medium text-fg-muted',
        'border-b-2 border-transparent transition-colors outline-none',
        'hover:text-fg focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]',
        'data-[state=active]:border-accent data-[state=active]:text-fg',
        className,
      )}
      {...props}
    />
  );
});

export const TabsContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(function TabsContent({ className, ...props }, ref) {
  return (
    <TabsPrimitive.Content
      ref={ref}
      className={cx('mt-4 outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]', className)}
      {...props}
    />
  );
});

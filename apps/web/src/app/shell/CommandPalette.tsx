import { Command as CommandPrimitive } from 'cmdk';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { Dialog, DialogContent } from '@/design-system';
import { useCan } from '@/lib/authz/useCan';
import type { Command } from '../types';

/**
 * Paleta de comandos (⌘K / Ctrl+K).
 *
 * En un sistema de 20 módulos y cientos de pantallas, el menú deja de escalar:
 * llegar a "nueva factura de compra" son cuatro clics y saber dónde mirar.
 * Escribir tres letras es siempre más rápido, y quien no la conozca sigue
 * teniendo el menú.
 */
export function CommandPalette({ commands }: { commands: Command[] }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const can = useCan();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const available = commands.filter((c) => !c.permission || can(c.permission));
  const groups = [...new Set(available.map((c) => c.group))];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent title="Buscar y ejecutar" description="Navega o ejecuta una acción" size="md">
        <CommandPrimitive label="Paleta de comandos" className="space-y-3">
          <div className="flex items-center gap-2 rounded-[var(--radius-control)] border border-border bg-surface-2 px-3">
            <Search className="size-4 shrink-0 text-fg-subtle" />
            <CommandPrimitive.Input
              // El foco automático desorienta cuando el formulario es una parte más
              // de la página; aquí ES la página (o el diálogo) entera.
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              placeholder="Escribe para buscar…"
              className="h-9 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle"
            />
          </div>

          <CommandPrimitive.List className="max-h-72 overflow-y-auto">
            <CommandPrimitive.Empty className="py-8 text-center text-sm text-fg-muted">
              Nada coincide con la búsqueda.
            </CommandPrimitive.Empty>

            {groups.map((group) => (
              <CommandPrimitive.Group
                key={group}
                heading={group}
                className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-fg-subtle"
              >
                {available
                  .filter((c) => c.group === group)
                  .map((command) => {
                    const Icon = command.icon;
                    return (
                      <CommandPrimitive.Item
                        key={command.id}
                        value={`${command.label} ${command.keywords?.join(' ') ?? ''}`}
                        onSelect={() => {
                          setOpen(false);
                          command.run((to) => navigate(to));
                        }}
                        className="flex cursor-pointer items-center gap-2.5 rounded px-2 py-2 text-sm text-fg data-[selected=true]:bg-surface-2"
                      >
                        {Icon && <Icon className="size-4 text-fg-subtle" />}
                        {command.label}
                      </CommandPrimitive.Item>
                    );
                  })}
              </CommandPrimitive.Group>
            ))}
          </CommandPrimitive.List>
        </CommandPrimitive>
      </DialogContent>
    </Dialog>
  );
}

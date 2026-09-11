import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Plus, Tag as TagIcon } from 'lucide-react';
import {
  Badge,
  Button,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Spinner,
} from '@/design-system';
import { useCollection } from '@/lib/api/useList';
import { patch, post } from '@/lib/api/client';
import { useCan } from '@/lib/authz/useCan';
import { useToast } from '@/store/toast';
import type { PartyTag } from '../lib/types';

interface Props {
  partyId: string;
  tags: PartyTag[];
  onChanged: () => void;
}

/**
 * Etiquetas de la ficha, con su selector.
 *
 * Asignar se hace con un PATCH de la ficha entera pasando la lista completa de
 * etiquetas, no con un endpoint por etiqueta: así dos cambios seguidos no pueden
 * dejar un estado a medias, y la auditoría registra un solo cambio con su antes
 * y su después en vez de una ristra de altas y bajas sueltas.
 */
export function TagsPanel({ partyId, tags, onChanged }: Props) {
  const can = useCan();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [newTag, setNewTag] = useState('');

  const all = useCollection<PartyTag>('/tags', { enabled: open && can('crm:tag:read') });
  const selected = new Set(tags.map((t) => t.id));

  const assign = useMutation({
    mutationFn: (tagIds: string[]) => patch(`/parties/${partyId}`, { tagIds }),
    onSuccess: onChanged,
    onError: toast.error,
  });

  const create = useMutation({
    mutationFn: (name: string) => post<PartyTag>('/tags', { name, kind: 'party' }),
    onSuccess: (tag) => {
      setNewTag('');
      void queryClient.invalidateQueries({ queryKey: ['/tags'] });
      assign.mutate([...selected, tag.id]);
    },
    onError: toast.error,
  });

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    assign.mutate([...next]);
  };

  if (!can('crm:tag:read')) {
    return (
      <>
        {tags.map((tag) => (
          <Badge key={tag.id}>{tag.name}</Badge>
        ))}
      </>
    );
  }

  return (
    <>
      {tags.map((tag) => (
        <Badge key={tag.id}>{tag.name}</Badge>
      ))}

      {can('crm:party:update') && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button size="sm" variant="ghost" icon={<TagIcon className="size-4" />}>
              Etiquetas
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-2">
            <div className="max-h-56 space-y-0.5 overflow-y-auto">
              {all.isLoading && (
                <div className="flex justify-center p-3">
                  <Spinner />
                </div>
              )}
              {all.data?.items.map((tag) => (
                <button
                  key={tag.id}
                  type="button"
                  className="flex w-full items-center justify-between gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-left text-sm hover:bg-surface-2"
                  onClick={() => toggle(tag.id)}
                >
                  <span className="truncate">{tag.name}</span>
                  {selected.has(tag.id) && <Check className="size-4 shrink-0 text-accent" />}
                </button>
              ))}
              {all.data?.items.length === 0 && (
                <p className="px-2 py-3 text-sm text-fg-subtle">Todavía no hay etiquetas.</p>
              )}
            </div>

            {can('crm:tag:manage') && (
              <form
                className="mt-2 flex gap-1 border-t border-border pt-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (newTag.trim()) create.mutate(newTag.trim());
                }}
              >
                <Input
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  placeholder="Nueva etiqueta"
                  aria-label="Nombre de la etiqueta nueva"
                />
                <Button
                  type="submit"
                  size="sm"
                  variant="primary"
                  icon={<Plus className="size-4" />}
                  aria-label="Crear etiqueta"
                  loading={create.isPending}
                />
              </form>
            )}
          </PopoverContent>
        </Popover>
      )}
    </>
  );
}

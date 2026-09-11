import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { Input, Spinner } from '@/design-system';
import { get } from '@/lib/api/client';

interface PartyHit {
  id: string;
  display_name: string;
  tax_id: string | null;
}

/**
 * Selector de cliente por búsqueda.
 *
 * Un desplegable con todos los clientes deja de servir a partir de doscientos, y
 * cualquier empresa con unos años los tiene. Busca contra el servidor, que es
 * quien sabe filtrar por nombre, NIT o correo a la vez.
 */
export function PartyPicker({
  value,
  label,
  onPick,
  id,
  ...props
}: {
  value: string;
  label: string;
  onPick: (party: PartyHit) => void;
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}) {
  // El texto se DERIVA de la etiqueta que llega del padre mientras nadie escriba.
  // Sincronizarlo desde un efecto lo convertiría en un segundo origen de verdad
  // que se queda atrás en cuanto el padre carga otra ficha.
  const [typed, setTyped] = useState<string | null>(null);
  const term = typed ?? label;
  const setTerm = setTyped;

  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState<PartyHit[]>([]);
  const [searching, setSearching] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const visible = term.trim().length < 2 ? [] : hits;

  useEffect(() => {
    if (term.trim().length < 2 || !open) return;
    const timer = setTimeout(() => {
      setSearching(true);
      get<{ items: PartyHit[] }>('/parties/search', { q: term, limit: 8 })
        .then((r) => setHits(r.items))
        .catch(() => setHits([]))
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [term, open]);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  return (
    <div ref={box} className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
        <Input
          {...props}
          id={id}
          className="pl-8"
          placeholder="Busca por nombre o NIT"
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
        />
      </div>
      {value && term === label && <p className="mt-0.5 text-xs text-fg-subtle">Cliente seleccionado</p>}

      {open && (visible.length > 0 || searching) && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-[var(--radius-control)] border border-border bg-surface shadow-lg">
          {searching && visible.length === 0 && (
            <li className="flex justify-center p-3">
              <Spinner />
            </li>
          )}
          {visible.map((hit) => (
            <li key={hit.id}>
              <button
                type="button"
                className="flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm hover:bg-surface-2"
                onClick={() => {
                  onPick(hit);
                  setTerm(hit.display_name);
                  setOpen(false);
                }}
              >
                <span className="truncate">{hit.display_name}</span>
                {hit.tax_id && <span className="font-mono text-xs text-fg-subtle">{hit.tax_id}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

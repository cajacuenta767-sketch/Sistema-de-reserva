import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search, Trash2 } from 'lucide-react';
import { Button, Input, Select, Spinner } from '@/design-system';
import { useCollection } from '@/lib/api/useList';
import { get } from '@/lib/api/client';
import { amount, money } from '@/lib/format';

export interface EditableLine {
  key: string;
  productId: string | null;
  description: string;
  sku: string | null;
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  taxId: string | null;
}

interface Tax {
  id: string;
  code: string;
  name: string;
  rate: string;
  is_withholding: boolean;
  applies_to: string;
  is_active: boolean;
}

interface ProductHit {
  id: string;
  sku: string;
  name: string;
  sale_price: string;
  purchase_price: string;
}

export const emptyLine = (): EditableLine => ({
  key: Math.random().toString(36).slice(2),
  productId: null,
  description: '',
  sku: null,
  quantity: '1',
  unitPrice: '',
  discountPercent: '',
  taxId: null,
});

/**
 * Editor de líneas de un documento.
 *
 * Los totales que muestra son ORIENTATIVOS y así se dice en pantalla: el número
 * que vale es el que devuelve el servidor al guardar, porque es el que se
 * imprime y el que se declara. Calcular aquí la cifra definitiva obligaría a
 * mantener dos implementaciones del mismo cálculo fiscal, y el día que
 * divergieran la pantalla diría una cosa y la factura otra.
 */
export function LineEditor({
  lines,
  currency,
  onChange,
  disabled,
  mode = 'SALE',
}: {
  lines: EditableLine[];
  currency: string;
  onChange: (lines: EditableLine[]) => void;
  disabled?: boolean;
  /**
   * Qué documento se está editando.
   *
   * Cambia el precio que se propone al elegir un producto y los impuestos que
   * se ofrecen. Es el MISMO editor a propósito: una copia para comprar
   * divergiría de la de vender en el primer arreglo, y el usuario aprendería
   * dos formas de escribir líneas que se parecen pero no son iguales.
   */
  mode?: 'SALE' | 'PURCHASE';
}) {
  const buying = mode === 'PURCHASE';
  const taxes = useCollection<Tax>('/taxes');
  const saleTaxes = useMemo(
    () =>
      taxes.data?.items.filter(
        (t) =>
          !t.is_withholding &&
          t.applies_to !== (buying ? 'SALE' : 'PURCHASE') &&
          t.is_active,
      ) ?? [],
    [taxes.data, buying],
  );

  const update = (key: string, patch: Partial<EditableLine>) =>
    onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const remove = (key: string) => onChange(lines.filter((l) => l.key !== key));

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-[var(--radius-control)] border border-border">
        <table className="w-full min-w-[52rem] text-sm">
          <thead className="bg-surface-2 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Concepto</th>
              <th className="w-24 px-3 py-2 text-right font-medium">Cantidad</th>
              <th className="w-32 px-3 py-2 text-right font-medium">Precio</th>
              <th className="w-20 px-3 py-2 text-right font-medium">Dto. %</th>
              <th className="w-40 px-3 py-2 font-medium">Impuesto</th>
              <th className="w-32 px-3 py-2 text-right font-medium">Importe</th>
              <th className="w-10 px-2 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {lines.map((line) => (
              <tr key={line.key}>
                <td className="px-3 py-2">
                  <ProductPicker
                    value={line.description}
                    sku={line.sku}
                    disabled={disabled}
                    priceOf={(hit) => (buying ? hit.purchase_price : hit.sale_price)}
                    onPick={(hit) =>
                      update(line.key, {
                        productId: hit.id,
                        description: hit.name,
                        sku: hit.sku,
                        // `?? ''` y no a secas: si el endpoint dejara de
                        // devolver el precio, la línea se queda vacía y se
                        // escribe a mano, en vez de tumbar toda la pantalla
                        // con un error que no dice qué falta.
                        unitPrice:
                          line.unitPrice ||
                          (buying ? (hit.purchase_price ?? '') : (hit.sale_price ?? '')),
                      })
                    }
                    onText={(text) => update(line.key, { description: text, productId: null, sku: null })}
                  />
                </td>
                <td className="px-3 py-2">
                  <Input
                    className="text-right"
                    inputMode="decimal"
                    aria-label="Cantidad"
                    disabled={disabled}
                    value={line.quantity}
                    onChange={(e) => update(line.key, { quantity: e.target.value })}
                  />
                </td>
                <td className="px-3 py-2">
                  <Input
                    className="text-right"
                    inputMode="decimal"
                    aria-label="Precio unitario"
                    placeholder="0"
                    disabled={disabled}
                    value={line.unitPrice}
                    onChange={(e) => update(line.key, { unitPrice: e.target.value })}
                  />
                </td>
                <td className="px-3 py-2">
                  <Input
                    className="text-right"
                    inputMode="decimal"
                    aria-label="Descuento"
                    placeholder="0"
                    disabled={disabled}
                    value={line.discountPercent}
                    onChange={(e) => update(line.key, { discountPercent: e.target.value })}
                  />
                </td>
                <td className="px-3 py-2">
                  <Select
                    aria-label="Impuesto"
                    disabled={disabled}
                    value={line.taxId ?? ''}
                    onChange={(e) => update(line.key, { taxId: e.target.value || null })}
                  >
                    <option value="">Del producto</option>
                    {saleTaxes.map((tax) => (
                      <option key={tax.id} value={tax.id}>
                        {tax.code}
                      </option>
                    ))}
                  </Select>
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-fg-muted">
                  {money(lineSubtotal(line), currency)}
                </td>
                <td className="px-2 py-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Trash2 className="size-4" />}
                    aria-label={`Quitar ${line.description || 'línea'}`}
                    disabled={disabled || lines.length === 1}
                    onClick={() => remove(line.key)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Button
        size="sm"
        icon={<Plus className="size-4" />}
        disabled={disabled}
        onClick={() => onChange([...lines, emptyLine()])}
      >
        Añadir línea
      </Button>
    </div>
  );
}

/** Base de la línea, sin impuestos: solo para orientar mientras se escribe. */
export const lineSubtotal = (line: EditableLine): string => {
  const quantity = Number(line.quantity.replace(',', '.')) || 0;
  const price = Number(line.unitPrice.replace(',', '.')) || 0;
  const discount = Number(line.discountPercent.replace(',', '.')) || 0;
  return String(quantity * price * (1 - discount / 100));
};

export const linesSubtotal = (lines: readonly EditableLine[]): number =>
  lines.reduce((acc, line) => acc + Number(lineSubtotal(line)), 0);

/**
 * Buscador de productos con escritura libre.
 *
 * Se puede facturar algo que no está en el catálogo —un reembolso de transporte,
 * un ajuste— sin obligar a darlo de alta primero. Obligar a ello haría que la
 * gente creara productos basura para poder cobrar.
 */
function ProductPicker({
  value,
  sku,
  disabled,
  onPick,
  onText,
  priceOf,
}: {
  value: string;
  sku: string | null;
  disabled?: boolean;
  onPick: (hit: ProductHit) => void;
  onText: (text: string) => void;
  /** Qué precio se enseña en la lista: el de venta o el de compra. */
  priceOf: (hit: ProductHit) => string;
}) {
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState<ProductHit[]>([]);
  const [searching, setSearching] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // Los resultados visibles se DERIVAN del término: con menos de dos letras no se
  // muestran, sin tener que vaciarlos desde el efecto. Escribir estado en un
  // efecto encadena renders y, con una búsqueda en vuelo, deja ver por un
  // instante los resultados de lo anterior.
  const visible = term.trim().length < 2 ? [] : hits;

  useEffect(() => {
    if (term.trim().length < 2) return;
    // Espera a que deje de escribir: una consulta por tecla satura el servidor y
    // devuelve resultados desordenados.
    const timer = setTimeout(() => {
      setSearching(true);
      get<{ items: ProductHit[] }>('/products/search', { q: term, limit: 8 })
        .then((r) => setHits(r.items))
        .catch(() => setHits([]))
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [term]);

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
          className="pl-8"
          aria-label="Concepto o producto"
          placeholder="Busca un producto o escribe el concepto"
          disabled={disabled}
          value={value}
          onChange={(e) => {
            onText(e.target.value);
            setTerm(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
        />
      </div>
      {sku && <p className="mt-0.5 font-mono text-xs text-fg-subtle">{sku}</p>}

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
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2"
                onClick={() => {
                  onPick(hit);
                  setOpen(false);
                  setTerm('');
                }}
              >
                <span className="min-w-0">
                  <span className="block truncate">{hit.name}</span>
                  <span className="block font-mono text-xs text-fg-subtle">{hit.sku}</span>
                </span>
                <span className="shrink-0 tabular-nums text-fg-muted">
                  {amount(priceOf(hit), 0)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

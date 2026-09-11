import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Calculator, Plus } from 'lucide-react';
import { Badge, Button, Empty, Field, Input, Select, Spinner } from '@/design-system';
import { useCollection, useResource } from '@/lib/api/useList';
import { post } from '@/lib/api/client';
import { Can } from '@/lib/authz/useCan';
import { useToast } from '@/store/toast';
import { money } from '@/lib/format';
import type { PriceList, Product } from '../lib/types';

interface ResolvedPrice {
  price: string;
  sourceListId: string | null;
  sourceLabel: string;
  includesTax: boolean;
  currencyCode: string;
  appliedTier: string | null;
}

/**
 * Precios de este producto en cada lista, y simulador de "¿a cuánto se lo vendo?".
 *
 * El simulador consulta el MISMO endpoint que usará cada línea de factura, así
 * que lo que muestra aquí es exactamente lo que se cobrará. Calcularlo en el
 * navegador daría una cifra que podría no coincidir con la del documento, que es
 * la peor forma de equivocarse: la pantalla dice una cosa y la factura otra.
 */
export function ProductPricesPanel({ product }: { product: Product }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const lists = useCollection<PriceList>('/price-lists?kind=SALE');

  const [listId, setListId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [newPrice, setNewPrice] = useState('');
  const [minQuantity, setMinQuantity] = useState('1');

  const params = new URLSearchParams({ quantity: quantity || '1' });
  if (listId) params.set('priceListId', listId);
  const resolved = useResource<ResolvedPrice>(`/products/${product.id}/price?${params.toString()}`, {
    staleTime: 0,
  });

  const targetList = listId || lists.data?.items.find((l) => l.isDefault)?.id || '';

  const setPrice = useMutation({
    mutationFn: () =>
      post(`/price-lists/${targetList}/items`, {
        productId: product.id,
        minQuantity: minQuantity.replace(',', '.') || '1',
        price: newPrice.replace(',', '.'),
      }),
    onSuccess: () => {
      toast.success('Precio fijado');
      setNewPrice('');
      void queryClient.invalidateQueries({ queryKey: [`/products/${product.id}/price?${params.toString()}`] });
    },
    onError: toast.error,
  });

  if (lists.isLoading) return <Spinner />;
  if (!lists.data || lists.data.items.length === 0) {
    return <Empty title="Sin listas de precios" description="Crea una lista para fijar precios negociados." />;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="card space-y-3 p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Calculator className="size-4" />
          ¿A cuánto se lo vendo?
        </h2>
        <p className="text-sm text-fg-muted">
          Consulta el mismo cálculo que usará la factura: lista aplicada, escala por cantidad y vigencia.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Lista de precios">
            {(props) => (
              <Select {...props} value={listId} onChange={(e) => setListId(e.target.value)}>
                <option value="">La que esté por defecto</option>
                {lists.data.items.map((list) => (
                  <option key={list.id} value={list.id}>
                    {list.name}
                    {list.isDefault ? ' (por defecto)' : ''}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Cantidad">
            {(props) => (
              <Input
                {...props}
                inputMode="decimal"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            )}
          </Field>
        </div>

        {resolved.data && (
          <div className="rounded-[var(--radius-control)] bg-surface-2 p-3">
            <p className="text-2xl font-semibold">
              {money(resolved.data.price, resolved.data.currencyCode)}
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-fg-muted">
              <span>Según «{resolved.data.sourceLabel}»</span>
              {resolved.data.appliedTier && <Badge tone="info">Desde {resolved.data.appliedTier} unidades</Badge>}
              {resolved.data.includesTax && <Badge tone="warning">Impuestos incluidos</Badge>}
            </p>
          </div>
        )}
      </section>

      <Can perm="catalog:pricelist:manage">
        <section className="card space-y-3 p-4">
          <h2 className="text-sm font-semibold">Fijar un precio</h2>
          <p className="text-sm text-fg-muted">
            Un precio explícito gana sobre el porcentaje de una lista derivada.
          </p>
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (newPrice.trim() && targetList) setPrice.mutate();
            }}
          >
            <Field label="Desde cantidad" hint="1 es el precio normal">
              {(props) => (
                <Input
                  {...props}
                  inputMode="decimal"
                  value={minQuantity}
                  onChange={(e) => setMinQuantity(e.target.value)}
                />
              )}
            </Field>
            <Field label="Precio">
              {(props) => (
                <Input
                  {...props}
                  inputMode="decimal"
                  placeholder="0"
                  value={newPrice}
                  onChange={(e) => setNewPrice(e.target.value)}
                />
              )}
            </Field>
            <Button
              type="submit"
              variant="primary"
              icon={<Plus className="size-4" />}
              loading={setPrice.isPending}
              disabled={!newPrice.trim()}
              className="sm:col-span-2"
            >
              Fijar en «{lists.data.items.find((l) => l.id === targetList)?.name ?? 'la lista'}»
            </Button>
          </form>
        </section>
      </Can>
    </div>
  );
}

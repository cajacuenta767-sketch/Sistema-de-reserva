import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Tags, Trash2 } from 'lucide-react';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  Empty,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
} from '@/design-system';
import { DataTable, type Column } from '@/design-system/data/DataTable';
import { useTableState } from '@/lib/url/useTableState';
import { useCollection, useList } from '@/lib/api/useList';
import { del, patch, post } from '@/lib/api/client';
import { Can, useCan } from '@/lib/authz/useCan';
import { useToast } from '@/store/toast';
import { amount, date, money } from '@/lib/format';
import type { PriceItemRow, PriceList } from '../lib/types';

/**
 * Listas de precios.
 *
 * Una lista derivada no guarda precios: guarda un porcentaje sobre otra lista,
 * de modo que subir la lista general sube todas las que dependen de ella sin
 * tocar nada más. Es la diferencia entre cambiar un número y revisar 2.000.
 */
export function PriceListsPage() {
  const can = useCan();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<PriceList | 'new' | null>(null);
  const [openList, setOpenList] = useState<PriceList | null>(null);

  const query = useCollection<PriceList>('/price-lists');
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['/price-lists'] });

  const remove = useMutation({
    mutationFn: (id: string) => del(`/price-lists/${id}`),
    onSuccess: () => {
      toast.success('Lista eliminada');
      invalidate();
    },
    onError: toast.error,
  });

  const items = query.data?.items ?? [];
  const nameOf = (id: string | null): string =>
    id ? (items.find((l) => l.id === id)?.name ?? '—') : '—';

  return (
    <>
      <PageHeader
        title="Listas de precios"
        description="Precios negociados por cliente, con escalas por cantidad y vigencia"
        actions={
          <Can perm="catalog:pricelist:manage">
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
              Nueva lista
            </Button>
          </Can>
        }
      />

      {query.isLoading && <Spinner />}
      {!query.isLoading && items.length === 0 && (
        <Empty icon={<Tags className="size-6" />} title="Sin listas de precios" />
      )}

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((list) => (
          <li key={list.id} className="card space-y-2 p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium">{list.name}</p>
                <p className="text-xs text-fg-muted">
                  {list.kind === 'SALE' ? 'Venta' : 'Compra'} · {list.currencyCode}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap justify-end gap-1">
                {list.isDefault && <Badge tone="accent">Por defecto</Badge>}
                {!list.isActive && <Badge tone="neutral">Inactiva</Badge>}
              </div>
            </div>

            <dl className="space-y-0.5 text-xs text-fg-muted">
              {list.mode === 'DERIVED' ? (
                <div className="flex gap-2">
                  <dt>Deriva de</dt>
                  <dd className="font-medium text-fg">
                    {nameOf(list.basedOnId)} · {Number(list.adjustmentPercent) >= 0 ? '−' : '+'}
                    {Math.abs(Number(list.adjustmentPercent))} %
                  </dd>
                </div>
              ) : (
                <div className="flex gap-2">
                  <dt>Tipo</dt>
                  <dd className="font-medium text-fg">Precios propios</dd>
                </div>
              )}
              {Number(list.rounding) > 0 && (
                <div className="flex gap-2">
                  <dt>Redondeo</dt>
                  <dd className="font-medium text-fg">a {amount(list.rounding, 0)}</dd>
                </div>
              )}
              {(list.validFrom || list.validTo) && (
                <div className="flex gap-2">
                  <dt>Vigencia</dt>
                  <dd className="font-medium text-fg">
                    {list.validFrom ? date(list.validFrom) : 'siempre'} → {list.validTo ? date(list.validTo) : 'siempre'}
                  </dd>
                </div>
              )}
              {list.includesTax && (
                <div className="flex gap-2">
                  <dt>Precios</dt>
                  <dd className="font-medium text-fg">con impuestos incluidos</dd>
                </div>
              )}
            </dl>

            <div className="flex flex-wrap gap-1 pt-1">
              <Button size="sm" onClick={() => setOpenList(list)}>
                Ver precios
              </Button>
              {can('catalog:pricelist:manage') && (
                <>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(list)}>
                    Editar
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Trash2 className="size-4" />}
                    aria-label={`Eliminar ${list.name}`}
                    onClick={() => remove.mutate(list.id)}
                  />
                </>
              )}
            </div>
          </li>
        ))}
      </ul>

      {editing && (
        <PriceListDialog
          list={editing === 'new' ? null : editing}
          all={items}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            invalidate();
          }}
        />
      )}

      {openList && <PriceItemsDialog list={openList} onClose={() => setOpenList(null)} />}
    </>
  );
}

function PriceItemsDialog({ list, onClose }: { list: PriceList; onClose: () => void }) {
  const table = useTableState({ defaultSort: [{ field: 'name', dir: 'asc' }] });
  const toast = useToast();
  const can = useCan();
  const queryClient = useQueryClient();
  const query = useList<PriceItemRow>(`/price-lists/${list.id}/items`, table.toQuery());

  const remove = useMutation({
    mutationFn: (id: string) => del(`/price-list-items/${id}`),
    onSuccess: () => {
      toast.success('Precio eliminado');
      void queryClient.invalidateQueries({ queryKey: [`/price-lists/${list.id}/items`] });
    },
    onError: toast.error,
  });

  const columns: Column<PriceItemRow>[] = [
    { id: 'sku', header: 'Código', sortable: true, cell: (row) => <span className="font-mono text-xs">{row.sku}</span> },
    { id: 'name', header: 'Producto', primary: true, sortable: true, cell: (row) => row.name },
    {
      id: 'min_quantity',
      header: 'Desde',
      numeric: true,
      sortable: true,
      cell: (row) => (Number(row.min_quantity) === 1 ? 'Cualquier cantidad' : `${row.min_quantity} uds.`),
    },
    {
      id: 'price',
      header: 'Precio',
      numeric: true,
      sortable: true,
      cell: (row) => money(row.price, list.currencyCode),
    },
  ];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={`Precios de «${list.name}»`}
        description={
          list.mode === 'DERIVED'
            ? 'Los productos sin precio explícito toman el de la lista base con su descuento aplicado.'
            : 'Los productos que no aparezcan aquí usan el precio de su ficha.'
        }
        size="xl"
      >
        <DataTable
          columns={columns}
          data={query.data}
          state={table.state}
          onStateChange={table.update}
          onToggleSort={table.toggleSort}
          rowId={(row) => row.id}
          loading={query.isFetching}
          error={query.error as Error | null}
          onRefresh={() => void query.refetch()}
          can={can}
          searchPlaceholder="Buscar producto…"
          emptyTitle="Sin precios fijados"
          emptyDescription="Fíjalos desde la pestaña «Precios» de cada producto."
          rowActions={[
            {
              label: 'Quitar',
              icon: <Trash2 className="size-4" />,
              destructive: true,
              hidden: () => !can('catalog:pricelist:manage'),
              onRun: (row) => remove.mutate(row.id),
            },
          ]}
        />
      </DialogContent>
    </Dialog>
  );
}

function PriceListDialog({
  list,
  all,
  onClose,
  onSaved,
}: {
  list: PriceList | null;
  all: PriceList[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [values, setValues] = useState({
    name: list?.name ?? '',
    kind: list?.kind ?? 'SALE',
    mode: list?.mode ?? 'FIXED',
    basedOnId: list?.basedOnId ?? '',
    adjustmentPercent: list?.adjustmentPercent ?? '0',
    rounding: list?.rounding ?? '0',
    includesTax: list?.includesTax ?? false,
    validFrom: list?.validFrom ?? '',
    validTo: list?.validTo ?? '',
    isDefault: list?.isDefault ?? false,
  });
  const [error, setError] = useState('');

  const set = (key: keyof typeof values, value: string | boolean) =>
    setValues((v) => ({ ...v, [key]: value }));

  const bases = all.filter((l) => l.id !== list?.id && l.kind === values.kind);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: values.name.trim(),
        kind: values.kind,
        mode: values.mode,
        basedOnId: values.mode === 'DERIVED' ? values.basedOnId || null : null,
        adjustmentPercent: values.adjustmentPercent.replace(',', '.') || '0',
        rounding: values.rounding.replace(',', '.') || '0',
        includesTax: values.includesTax,
        validFrom: values.validFrom || null,
        validTo: values.validTo || null,
        isDefault: values.isDefault,
      };
      return list ? patch(`/price-lists/${list.id}`, body) : post('/price-lists', body);
    },
    onSuccess: () => {
      toast.success('Lista guardada');
      onSaved();
    },
    onError: toast.error,
  });

  const submit = () => {
    if (!values.name.trim()) {
      setError('El nombre es obligatorio');
      return;
    }
    if (values.mode === 'DERIVED' && !values.basedOnId) {
      setError('Una lista derivada necesita una lista base');
      return;
    }
    setError('');
    save.mutate();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={list ? 'Editar lista' : 'Nueva lista de precios'}
        size="md"
        footer={
          <>
            <Button onClick={onClose}>Cancelar</Button>
            <Button variant="primary" loading={save.isPending} onClick={submit}>
              Guardar
            </Button>
          </>
        }
      >
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {error && <p className="sm:col-span-2 text-sm text-danger-fg">{error}</p>}

          <Field label="Nombre" required className="sm:col-span-2">
            {(props) => (
              <Input
                {...props}
                // eslint-disable-next-line jsx-a11y/no-autofocus -- dentro de un diálogo el foco ya está atrapado
                autoFocus
                placeholder="Distribuidores"
                value={values.name}
                onChange={(e) => set('name', e.target.value)}
              />
            )}
          </Field>

          <Field label="Para">
            {(props) => (
              <Select {...props} disabled={Boolean(list)} value={values.kind} onChange={(e) => set('kind', e.target.value)}>
                <option value="SALE">Vender</option>
                <option value="PURCHASE">Comprar</option>
              </Select>
            )}
          </Field>

          <Field label="Cómo fija los precios">
            {(props) => (
              <Select {...props} value={values.mode} onChange={(e) => set('mode', e.target.value)}>
                <option value="FIXED">Precios propios</option>
                <option value="DERIVED">Porcentaje sobre otra lista</option>
              </Select>
            )}
          </Field>

          {values.mode === 'DERIVED' && (
            <>
              <Field label="Lista base" required>
                {(props) => (
                  <Select {...props} value={values.basedOnId} onChange={(e) => set('basedOnId', e.target.value)}>
                    <option value="">Elige una</option>
                    {bases.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Descuento" hint="15 significa 15 % menos. Negativo es un recargo">
                {(props) => (
                  <Input
                    {...props}
                    inputMode="decimal"
                    value={values.adjustmentPercent}
                    onChange={(e) => set('adjustmentPercent', e.target.value)}
                  />
                )}
              </Field>
            </>
          )}

          <Field label="Redondear a" hint="100 deja los precios en centenas. 0 no redondea">
            {(props) => (
              <Input
                {...props}
                inputMode="decimal"
                value={values.rounding}
                onChange={(e) => set('rounding', e.target.value)}
              />
            )}
          </Field>

          <Field label="Vigente desde">
            {(props) => (
              <Input {...props} type="date" value={values.validFrom} onChange={(e) => set('validFrom', e.target.value)} />
            )}
          </Field>

          <Field label="Vigente hasta">
            {(props) => (
              <Input {...props} type="date" value={values.validTo} onChange={(e) => set('validTo', e.target.value)} />
            )}
          </Field>

          <label className="sm:col-span-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-[var(--color-accent)]"
              checked={values.includesTax}
              onChange={(e) => set('includesTax', e.target.checked)}
            />
            Los precios ya llevan impuestos incluidos
          </label>

          <label className="sm:col-span-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-[var(--color-accent)]"
              checked={values.isDefault}
              onChange={(e) => set('isDefault', e.target.checked)}
            />
            Usar como lista por defecto
          </label>
        </form>
      </DialogContent>
    </Dialog>
  );
}

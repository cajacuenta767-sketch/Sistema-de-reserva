import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Warehouse as WarehouseIcon } from 'lucide-react';
import { Badge, Button, Dialog, DialogContent, Field, Input, PageHeader } from '@/design-system';
import { DataTable, type Column } from '@/design-system/data/DataTable';
import { useTableState } from '@/lib/url/useTableState';
import { useList } from '@/lib/api/useList';
import { post } from '@/lib/api/client';
import { Can, useCan } from '@/lib/authz/useCan';
import { useToast } from '@/store/toast';
import { amount, money } from '@/lib/format';
import type { WarehouseRow } from '../lib/types';

export function WarehousesPage() {
  const table = useTableState({ defaultSort: [{ field: 'code', dir: 'asc' }] });
  const can = useCan();
  const toast = useToast();
  const queryClient = useQueryClient();
  const query = useList<WarehouseRow>('/inventory/warehouses', table.toQuery());

  const [creating, setCreating] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [error, setError] = useState('');

  const create = useMutation({
    mutationFn: () =>
      post('/inventory/warehouses', {
        code: code.trim().toUpperCase(),
        name: name.trim(),
        ...(city.trim() ? { city: city.trim() } : {}),
      }),
    onSuccess: () => {
      toast.success('Bodega creada');
      void queryClient.invalidateQueries({ queryKey: ['/inventory/warehouses'] });
      setCreating(false);
      setCode('');
      setName('');
      setCity('');
    },
    onError: toast.error,
  });

  const columns = useMemo<Column<WarehouseRow>[]>(
    () => [
      {
        id: 'code',
        header: 'Código',
        sortable: true,
        primary: true,
        cell: (row) => <span className="font-mono text-xs">{row.code}</span>,
      },
      {
        id: 'name',
        header: 'Bodega',
        sortable: true,
        cell: (row) => (
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{row.name}</span>
            {row.is_default && <Badge tone="accent">Por defecto</Badge>}
            {!row.is_active && <Badge tone="neutral">Inactiva</Badge>}
          </div>
        ),
      },
      { id: 'city', header: 'Ciudad', sortable: true, cell: (row) => row.city ?? '—' },
      {
        id: 'total_units',
        header: 'Unidades',
        numeric: true,
        cell: (row) => amount(row.total_units, 0),
      },
      {
        id: 'total_value',
        header: 'Valor',
        numeric: true,
        cell: (row) => money(row.total_value),
      },
    ],
    [],
  );

  return (
    <>
      <PageHeader
        title="Bodegas"
        description="Dónde está la mercancía"
        actions={
          <Can perm="inventory:warehouse:create">
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              Nueva bodega
            </Button>
          </Can>
        }
      />

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
        searchPlaceholder="Buscar por código, nombre o ciudad…"
        emptyTitle="No hay bodegas"
        emptyDescription="La empresa nace con una bodega principal; puedes añadir más."
      />

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent title="Nueva bodega" description="Un sitio donde guardar mercancía">
          <div className="grid gap-3">
            <Field label="Código" required error={error || undefined} hint="Corto: PRIN, NORTE, TIENDA2.">
              {(props) => (
                <Input
                  {...props}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  maxLength={20}
                />
              )}
            </Field>
            <Field label="Nombre" required>
              {(props) => <Input {...props} value={name} onChange={(e) => setName(e.target.value)} />}
            </Field>
            <Field label="Ciudad">
              {(props) => <Input {...props} value={city} onChange={(e) => setCity(e.target.value)} />}
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setCreating(false)}>
                Cancelar
              </Button>
              <Button
                variant="primary"
                loading={create.isPending}
                onClick={() => {
                  if (!code.trim() || !name.trim()) {
                    return setError('El código y el nombre son obligatorios');
                  }
                  setError('');
                  create.mutate();
                }}
              >
                Crear
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <p className="flex items-start gap-2 text-xs text-fg-subtle">
        <WarehouseIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <span>
          Una bodega con movimientos no se borra: se desactiva, y su kardex sigue consultable.
        </span>
      </p>
    </>
  );
}

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Plus } from 'lucide-react';
import { Badge, Button, Dialog, DialogContent, Field, PageHeader, Select } from '@/design-system';
import { DataTable, type Column } from '@/design-system/data/DataTable';
import { useTableState } from '@/lib/url/useTableState';
import { useCollection, useList } from '@/lib/api/useList';
import { post } from '@/lib/api/client';
import { Can, useCan } from '@/lib/authz/useCan';
import { useToast } from '@/store/toast';
import { dateShort, number } from '@/lib/format';
import { COUNT_STATUS } from '../lib/labels';
import type { CountDetail, CountRow, Warehouse } from '../lib/types';

export function CountsPage() {
  const table = useTableState({ defaultSort: [{ field: 'count_date', dir: 'desc' }] });
  const can = useCan();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();

  const query = useList<CountRow>('/inventory/stock-counts', table.toQuery());
  const warehouses = useCollection<Warehouse>('/inventory/warehouses/all');
  const [opening, setOpening] = useState(false);
  const [warehouseId, setWarehouseId] = useState('');

  const open = useMutation({
    mutationFn: () => post<CountDetail>('/inventory/stock-counts', { warehouseId }),
    onSuccess: (result) => {
      toast.success(`Conteo abierto con ${result.summary.lines} productos`);
      void queryClient.invalidateQueries({ queryKey: ['/inventory/stock-counts'] });
      setOpening(false);
      navigate(`/inventario/conteos/${result.count.id}`);
    },
    onError: toast.error,
  });

  const columns = useMemo<Column<CountRow>[]>(
    () => [
      {
        id: 'number',
        header: 'Número',
        sortable: true,
        primary: true,
        cell: (row) =>
          row.number ? (
            <span className="font-mono text-xs">{row.number}</span>
          ) : (
            <span className="text-fg-subtle">Sin aplicar</span>
          ),
      },
      { id: 'count_date', header: 'Fecha', sortable: true, cell: (row) => dateShort(row.count_date) },
      { id: 'warehouse_name', header: 'Bodega', cell: (row) => row.warehouse_name },
      {
        id: 'status',
        header: 'Estado',
        sortable: true,
        cell: (row) => {
          const status = COUNT_STATUS[row.status];
          return (
            <Badge tone={status?.tone ?? 'neutral'} dot>
              {status?.label ?? row.status}
            </Badge>
          );
        },
      },
      {
        id: 'counted_count',
        header: 'Avance',
        numeric: true,
        cell: (row) => (
          <span className={row.counted_count < row.line_count ? 'text-fg-muted' : ''}>
            {number(row.counted_count)} / {number(row.line_count)}
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <>
      <PageHeader
        title="Conteos físicos"
        description="Contar lo que hay y cuadrar el inventario"
        actions={
          <Can perm="inventory:count:create">
            <Button
              variant="primary"
              icon={<Plus className="size-4" />}
              onClick={() => {
                setWarehouseId(warehouses.data?.items[0]?.id ?? '');
                setOpening(true);
              }}
            >
              Abrir conteo
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
        onRowClick={(row) => navigate(`/inventario/conteos/${row.id}`)}
        can={can}
        searchPlaceholder="Buscar por número…"
        emptyTitle="Todavía no has hecho conteos"
        emptyDescription="Un conteo congela lo que dice el sistema y lo compara con lo que hay."
      />

      <Dialog open={opening} onOpenChange={setOpening}>
        <DialogContent
          title="Abrir un conteo"
          description="Se congelan las existencias de la bodega en este momento"
        >
          <div className="grid gap-3">
            <Field
              label="Bodega"
              required
              hint="Lo que el sistema diga AHORA queda registrado como esperado: las ventas posteriores no lo cambian."
            >
              {(props) => (
                <Select
                  {...props}
                  value={warehouseId}
                  onChange={(e) => setWarehouseId(e.target.value)}
                >
                  {(warehouses.data?.items ?? []).map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpening(false)}>
                Cancelar
              </Button>
              <Button
                variant="primary"
                loading={open.isPending}
                disabled={!warehouseId}
                onClick={() => open.mutate()}
              >
                Abrir
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <p className="flex items-start gap-2 text-xs text-fg-subtle">
        <ClipboardList className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <span>
          Las líneas que se dejen sin contar no se tocan al aplicar: aplicarlas como cero
          convertiría un conteo a medias en una baja masiva de inventario.
        </span>
      </p>
    </>
  );
}

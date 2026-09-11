import { useMemo, useState } from 'react';
import { AlertTriangle, Boxes, Coins, Package, SlidersHorizontal } from 'lucide-react';
import { Badge, PageHeader, Select, StatTile } from '@/design-system';
import { DataTable, type Column } from '@/design-system/data/DataTable';
import { useTableState } from '@/lib/url/useTableState';
import { useCollection, useList } from '@/lib/api/useList';
import { Can, useCan } from '@/lib/authz/useCan';
import { amount, money } from '@/lib/format';
import { AdjustDialog } from '../components/AdjustDialog';
import type { StockRow, Warehouse } from '../lib/types';

/**
 * Existencias.
 *
 * La columna que importa es "disponible", no "existencias": lo reservado ya
 * está comprometido con otro pedido, y ofrecerlo otra vez hace que dos
 * vendedores prometan la misma unidad.
 */
export function StockPage() {
  const table = useTableState({ defaultSort: [{ field: 'product_name', dir: 'asc' }] });
  const can = useCan();
  const warehouses = useCollection<Warehouse>('/inventory/warehouses/all');
  const query = useList<StockRow>('/inventory/stock', table.toQuery());
  const [adjusting, setAdjusting] = useState<StockRow | null>(null);

  const columns = useMemo<Column<StockRow>[]>(
    () => [
      {
        id: 'product_name',
        header: 'Producto',
        sortable: true,
        primary: true,
        cell: (row) => (
          <div className="min-w-0">
            <div className="truncate font-medium">{row.product_name}</div>
            {row.sku && <div className="font-mono text-xs text-fg-subtle">{row.sku}</div>}
          </div>
        ),
      },
      { id: 'warehouse_name', header: 'Bodega', cell: (row) => row.warehouse_name },
      {
        id: 'quantity',
        header: 'Existencias',
        numeric: true,
        sortable: true,
        cell: (row) => amount(row.quantity, 0),
      },
      {
        id: 'reserved',
        header: 'Reservado',
        numeric: true,
        cell: (row) =>
          Number(row.reserved) > 0 ? (
            amount(row.reserved, 0)
          ) : (
            <span className="text-fg-subtle">—</span>
          ),
      },
      {
        id: 'available',
        header: 'Disponible',
        numeric: true,
        sortable: true,
        cell: (row) => (
          <span className={row.below_minimum ? 'font-medium text-danger-fg' : 'font-medium'}>
            {amount(row.available, 0)}
          </span>
        ),
      },
      {
        id: 'below_minimum',
        header: 'Estado',
        cell: (row) =>
          row.below_minimum ? (
            <Badge tone="danger" dot>
              Bajo mínimo
            </Badge>
          ) : Number(row.available) <= 0 ? (
            <Badge tone="warning" dot>
              Sin existencias
            </Badge>
          ) : (
            <Badge tone="success" dot>
              Disponible
            </Badge>
          ),
      },
      {
        id: 'average_cost',
        header: 'Costo promedio',
        numeric: true,
        cell: (row) => money(row.average_cost),
      },
      {
        id: 'value',
        header: 'Valor',
        numeric: true,
        sortable: true,
        cell: (row) => money(row.value),
      },
      {
        id: 'min_stock',
        header: 'Mínimo',
        numeric: true,
        hiddenByDefault: true,
        cell: (row) => (row.min_stock ? amount(row.min_stock, 0) : '—'),
      },
    ],
    [],
  );

  const aggregates = query.data?.aggregates;
  const filterValue = (field: string): string =>
    (table.state.filters.find((f) => f.field === field)?.value as string | undefined) ?? '';

  return (
    <>
      <PageHeader title="Existencias" description="Qué hay en bodega y cuánto vale" />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile
          label="Unidades en bodega"
          value={amount(String(aggregates?.total_units ?? 0), 0)}
          icon={<Boxes className="size-5" />}
        />
        <StatTile
          label="Valor del inventario"
          value={money(String(aggregates?.total_value ?? '0'))}
          hint="Al costo promedio, no al precio de venta"
          icon={<Coins className="size-5" />}
          tone="accent"
        />
        <StatTile
          label="Bajo mínimo"
          value={String(aggregates?.below_minimum_count ?? 0)}
          hint="Productos que hay que reponer"
          icon={<AlertTriangle className="size-5" />}
          tone={Number(aggregates?.below_minimum_count ?? 0) > 0 ? 'danger' : 'success'}
          onClick={() => table.setFilter('below_minimum', 'eq', 'true')}
        />
      </div>

      <DataTable
        columns={columns}
        data={query.data}
        state={table.state}
        onStateChange={table.update}
        onToggleSort={table.toggleSort}
        rowId={(row) => `${row.product_id}-${row.warehouse_id}`}
        loading={query.isFetching}
        error={query.error as Error | null}
        onRefresh={() => void query.refetch()}
        can={can}
        searchPlaceholder="Buscar por producto o SKU…"
        emptyTitle="Todavía no hay existencias"
        emptyDescription="El inventario se mueve al recibir mercancía de una compra."
        aggregateLabels={{
          total_units: 'Unidades',
          total_value: { label: 'Valor al costo', as: 'money' },
          below_minimum_count: 'Bajo mínimo',
        }}
        rowActions={
          can('inventory:move:adjust')
            ? [
                {
                  label: 'Ajustar existencias',
                  icon: <SlidersHorizontal className="size-4" />,
                  onRun: (row) => setAdjusting(row),
                },
              ]
            : []
        }
        filters={
          <Select
            value={filterValue('warehouse_id')}
            onChange={(e) => table.setFilter('warehouse_id', 'eq', e.target.value || null)}
            className="h-9 w-auto"
            aria-label="Filtrar por bodega"
          >
            <option value="">Todas las bodegas</option>
            {(warehouses.data?.items ?? []).map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
        }
      />

      <Can perm="inventory:move:adjust">
        <AdjustDialog
          row={adjusting}
          onDone={() => {
            setAdjusting(null);
            void query.refetch();
          }}
          onClose={() => setAdjusting(null)}
        />
      </Can>

      <p className="flex items-start gap-2 text-xs text-fg-subtle">
        <Package className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <span>
          Lo disponible es lo que hay menos lo reservado para pedidos en curso. El inventario se
          valora al costo promedio ponderado, nunca al precio de venta.
        </span>
      </p>
    </>
  );
}

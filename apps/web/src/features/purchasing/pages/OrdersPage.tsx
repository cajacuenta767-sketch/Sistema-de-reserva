import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Clock, Plus, ShoppingCart, Wallet } from 'lucide-react';
import { Badge, Button, PageHeader, Select, StatTile } from '@/design-system';
import { DataTable, type Column } from '@/design-system/data/DataTable';
import { useTableState } from '@/lib/url/useTableState';
import { useList, useResource } from '@/lib/api/useList';
import { Can, useCan } from '@/lib/authz/useCan';
import { dateShort, money, number, percent } from '@/lib/format';
import { ORDER_STATUS } from '../lib/labels';
import type { OrderRow, PurchasingOverview } from '../lib/types';

export function OrdersPage() {
  const table = useTableState({ defaultSort: [{ field: 'order_date', dir: 'desc' }] });
  const can = useCan();
  const navigate = useNavigate();
  const query = useList<OrderRow>('/purchasing/orders', table.toQuery());
  const overview = useResource<PurchasingOverview>('/purchasing/overview');

  const columns = useMemo<Column<OrderRow>[]>(
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
            <span className="text-fg-subtle">Borrador</span>
          ),
      },
      {
        id: 'party_name',
        header: 'Proveedor',
        sortable: true,
        cell: (row) => (
          <div className="min-w-0">
            <div className="truncate font-medium">{row.party_name}</div>
            {row.party_tax_id && <div className="text-xs text-fg-subtle">{row.party_tax_id}</div>}
          </div>
        ),
      },
      { id: 'order_date', header: 'Fecha', sortable: true, cell: (row) => dateShort(row.order_date) },
      {
        id: 'expected_date',
        header: 'Se espera',
        sortable: true,
        cell: (row) => (row.expected_date ? dateShort(row.expected_date) : '—'),
      },
      {
        id: 'status',
        header: 'Estado',
        sortable: true,
        cell: (row) => {
          const status = ORDER_STATUS[row.status];
          return (
            <Badge tone={status?.tone ?? 'neutral'} dot>
              {status?.label ?? row.status}
            </Badge>
          );
        },
      },
      {
        id: 'received_percent',
        header: 'Recibido',
        numeric: true,
        cell: (row) =>
          row.status === 'DRAFT' || row.status === 'CANCELLED' ? (
            <span className="text-fg-subtle">—</span>
          ) : (
            percent(row.received_percent, 0)
          ),
      },
      {
        id: 'total',
        header: 'Total',
        numeric: true,
        sortable: true,
        cell: (row) => money(row.total, row.currency_code),
      },
      {
        id: 'warehouse_name',
        header: 'Bodega',
        hiddenByDefault: true,
        cell: (row) => row.warehouse_name ?? '—',
      },
    ],
    [],
  );

  const filterValue = (field: string): string =>
    (table.state.filters.find((f) => f.field === field)?.value as string | undefined) ?? '';

  return (
    <>
      <PageHeader
        title="Órdenes de compra"
        description="Lo que se pidió y lo que falta por llegar"
        actions={
          <Can perm="purchasing:order:create">
            <Button
              variant="primary"
              icon={<Plus className="size-4" />}
              onClick={() => navigate('/compras/ordenes/nueva')}
            >
              Nueva orden
            </Button>
          </Can>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Órdenes abiertas"
          value={number(overview.data?.openOrders ?? 0)}
          icon={<ShoppingCart className="size-5" />}
        />
        <StatTile
          label="Con retraso"
          value={number(overview.data?.lateOrders ?? 0)}
          hint="Pasó la fecha esperada y no ha llegado"
          icon={<Clock className="size-5" />}
          tone={(overview.data?.lateOrders ?? 0) > 0 ? 'danger' : 'success'}
        />
        <StatTile
          label="Se espera esta semana"
          value={money(overview.data?.expectedThisWeek ?? '0')}
          icon={<Wallet className="size-5" />}
        />
        <StatTile
          label="Por pagar vencido"
          value={money(overview.data?.overduePayable ?? '0')}
          hint={
            overview.data ? `${number(overview.data.overdueBills)} facturas vencidas` : undefined
          }
          icon={<AlertTriangle className="size-5" />}
          tone={(overview.data?.overdueBills ?? 0) > 0 ? 'danger' : 'success'}
          onClick={() => navigate('/compras/por-pagar')}
        />
      </div>

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
        onRowClick={(row) => navigate(`/compras/ordenes/${row.id}`)}
        can={can}
        searchPlaceholder="Buscar por número o proveedor…"
        emptyTitle="Todavía no has hecho pedidos"
        emptyDescription="Una orden de compra dice lo que se pidió; no mueve inventario hasta que llega."
        aggregateLabels={{
          total_amount: { label: 'Total pedido', as: 'money' },
          open_count: 'Abiertas',
        }}
        filters={
          <Select
            value={filterValue('status')}
            onChange={(e) => table.setFilter('status', 'eq', e.target.value || null)}
            className="h-9 w-auto"
            aria-label="Filtrar por estado"
          >
            <option value="">Todos los estados</option>
            {Object.entries(ORDER_STATUS).map(([value, { label }]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        }
      />
    </>
  );
}

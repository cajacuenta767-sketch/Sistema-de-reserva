import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, FileText, Plus, Wallet } from 'lucide-react';
import { Badge, Button, PageHeader, Select, StatTile } from '@/design-system';
import { DataTable, type Column } from '@/design-system/data/DataTable';
import { useTableState } from '@/lib/url/useTableState';
import { useList, useResource } from '@/lib/api/useList';
import { Can, useCan } from '@/lib/authz/useCan';
import { dateShort, money, number } from '@/lib/format';
import { BILL_STATUS } from '../lib/labels';
import type { BillRow, PurchasingOverview } from '../lib/types';

export function BillsPage() {
  const table = useTableState({ defaultSort: [{ field: 'due_date', dir: 'asc' }] });
  const can = useCan();
  const navigate = useNavigate();
  const query = useList<BillRow>('/purchasing/bills', table.toQuery());
  const overview = useResource<PurchasingOverview>('/purchasing/overview');

  const columns = useMemo<Column<BillRow>[]>(
    () => [
      {
        id: 'supplier_number',
        header: 'Nº del proveedor',
        sortable: true,
        primary: true,
        cell: (row) => (
          <div className="min-w-0">
            <div className="font-mono text-xs">{row.supplier_number}</div>
            {row.number && <div className="text-xs text-fg-subtle">Interno {row.number}</div>}
          </div>
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
      { id: 'issue_date', header: 'Emisión', sortable: true, cell: (row) => dateShort(row.issue_date) },
      {
        id: 'due_date',
        header: 'Vence',
        sortable: true,
        cell: (row) => (
          <div>
            <div>{dateShort(row.due_date)}</div>
            {row.days_overdue > 0 && (
              <div className="text-xs text-danger-fg">{number(row.days_overdue)} días de mora</div>
            )}
          </div>
        ),
      },
      {
        id: 'effective_status',
        header: 'Estado',
        sortable: true,
        cell: (row) => {
          const status = BILL_STATUS[row.effective_status];
          return (
            <Badge tone={status?.tone ?? 'neutral'} dot>
              {status?.label ?? row.effective_status}
            </Badge>
          );
        },
      },
      {
        id: 'total',
        header: 'Total',
        numeric: true,
        sortable: true,
        cell: (row) => money(row.total, row.currency_code),
      },
      {
        id: 'outstanding',
        header: 'Saldo',
        numeric: true,
        sortable: true,
        cell: (row) =>
          Number(row.outstanding) > 0 ? (
            <span className="font-medium">{money(row.outstanding, row.currency_code)}</span>
          ) : (
            <span className="text-fg-subtle">—</span>
          ),
      },
    ],
    [],
  );

  const filterValue = (field: string): string =>
    (table.state.filters.find((f) => f.field === field)?.value as string | undefined) ?? '';

  return (
    <>
      <PageHeader
        title="Facturas de proveedor"
        description="Lo que te cobran y lo que debes"
        actions={
          <Can perm="purchasing:bill:create">
            <Button
              variant="primary"
              icon={<Plus className="size-4" />}
              onClick={() => navigate('/compras/facturas/nueva')}
            >
              Registrar factura
            </Button>
          </Can>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile
          label="Total por pagar"
          value={money(overview.data?.payable ?? '0')}
          icon={<Wallet className="size-5" />}
        />
        <StatTile
          label="Vencido"
          value={money(overview.data?.overduePayable ?? '0')}
          hint={overview.data ? `${number(overview.data.overdueBills)} facturas` : undefined}
          icon={<AlertTriangle className="size-5" />}
          tone={(overview.data?.overdueBills ?? 0) > 0 ? 'danger' : 'success'}
          onClick={() => table.setFilter('effective_status', 'eq', 'OVERDUE')}
        />
        <StatTile
          label="Órdenes abiertas"
          value={number(overview.data?.openOrders ?? 0)}
          icon={<FileText className="size-5" />}
          onClick={() => navigate('/compras/ordenes')}
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
        onRowClick={(row) => navigate(`/compras/facturas/${row.id}`)}
        can={can}
        searchPlaceholder="Buscar por número del proveedor o nombre…"
        emptyTitle="Todavía no hay facturas de proveedor"
        emptyDescription="Regístralas para llevar las cuentas por pagar y descontar el IVA."
        aggregateLabels={{
          total_amount: { label: 'Total facturado', as: 'money' },
          outstanding_amount: { label: 'Pendiente de pago', as: 'money' },
          overdue_count: 'Vencidas',
        }}
        filters={
          <Select
            value={filterValue('effective_status')}
            onChange={(e) => table.setFilter('effective_status', 'eq', e.target.value || null)}
            className="h-9 w-auto"
            aria-label="Filtrar por estado"
          >
            <option value="">Todos los estados</option>
            {Object.entries(BILL_STATUS).map(([value, { label }]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        }
      />

      <p className="text-xs text-fg-subtle">
        Un proveedor no puede tener dos facturas con el mismo número: registrarla dos veces
        significa pagarla dos veces.
      </p>
    </>
  );
}

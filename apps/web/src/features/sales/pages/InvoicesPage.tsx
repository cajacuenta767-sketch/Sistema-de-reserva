import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, FileText, Plus, TrendingUp, Wallet } from 'lucide-react';
import { Badge, Button, PageHeader, Select, StatTile } from '@/design-system';
import { DataTable, type Column } from '@/design-system/data/DataTable';
import { useTableState } from '@/lib/url/useTableState';
import { useList, useResource } from '@/lib/api/useList';
import { Can, useCan } from '@/lib/authz/useCan';
import { dateShort, money, number } from '@/lib/format';
import { INVOICE_STATUS } from '../lib/labels';
import type { InvoiceRow, SalesOverview } from '../lib/types';

export function InvoicesPage() {
  const table = useTableState({ defaultSort: [{ field: 'issue_date', dir: 'desc' }] });
  const can = useCan();
  const navigate = useNavigate();

  const query = useList<InvoiceRow>('/invoices', table.toQuery());
  const overview = useResource<SalesOverview>('/invoices/overview');

  const columns = useMemo<Column<InvoiceRow>[]>(
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
        header: 'Cliente',
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
          const status = INVOICE_STATUS[row.effective_status];
          return (
            <Badge tone={status.tone} dot>
              {status.label}
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
      {
        id: 'party_tax_id',
        header: 'NIT',
        sortable: false,
        hiddenByDefault: true,
        cell: (row) => row.party_tax_id ?? '—',
      },
    ],
    [],
  );

  const filterValue = (field: string): string =>
    (table.state.filters.find((f) => f.field === field)?.value as string | undefined) ?? '';

  return (
    <>
      <PageHeader
        title="Facturas de venta"
        description="Lo que has facturado y lo que te deben"
        actions={
          <Can perm="sales:invoice:create">
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => navigate('/facturas/nueva')}>
              Nueva factura
            </Button>
          </Can>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Facturado este mes"
          value={money(overview.data?.issuedThisMonth ?? '0')}
          icon={<TrendingUp className="size-5" />}
          tone="accent"
        />
        <StatTile
          label="Cobrado este mes"
          value={money(overview.data?.collectedThisMonth ?? '0')}
          icon={<Wallet className="size-5" />}
          tone="success"
        />
        <StatTile
          label="Cartera pendiente"
          value={money(overview.data?.outstanding ?? '0')}
          icon={<FileText className="size-5" />}
        />
        <StatTile
          label="Vencido"
          hint={overview.data ? `${overview.data.overdueCount} facturas` : undefined}
          value={money(overview.data?.overdueAmount ?? '0')}
          icon={<AlertTriangle className="size-5" />}
          tone={overview.data && overview.data.overdueCount > 0 ? 'danger' : 'success'}
          onClick={() => table.setFilter('effective_status', 'eq', 'OVERDUE')}
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
        onRowClick={(row) => navigate(`/facturas/${row.id}`)}
        can={can}
        searchPlaceholder="Buscar por número, cliente o NIT…"
        emptyTitle="Todavía no has facturado"
        emptyDescription="Crea la primera factura o convierte una cotización aceptada."
        aggregateLabels={{
          total_amount: { label: 'Total facturado', as: 'money' },
          outstanding_amount: { label: 'Pendiente de cobro', as: 'money' },
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
            {Object.entries(INVOICE_STATUS).map(([value, { label }]) => (
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

import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { PackageCheck } from 'lucide-react';
import { Badge, PageHeader, Select } from '@/design-system';
import { DataTable, type Column } from '@/design-system/data/DataTable';
import { useTableState } from '@/lib/url/useTableState';
import { useList } from '@/lib/api/useList';
import { useCan } from '@/lib/authz/useCan';
import { dateShort, money, number } from '@/lib/format';
import { RECEIPT_STATUS } from '../lib/labels';
import type { ReceiptRow } from '../lib/types';

/**
 * Recepciones de mercancía.
 *
 * Es el documento que mueve el inventario: ni la orden ni la factura lo hacen.
 */
export function ReceiptsPage() {
  const table = useTableState({ defaultSort: [{ field: 'receipt_date', dir: 'desc' }] });
  const can = useCan();
  const navigate = useNavigate();
  const query = useList<ReceiptRow>('/purchasing/receipts', table.toQuery());

  const columns = useMemo<Column<ReceiptRow>[]>(
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
        cell: (row) => <span className="font-medium">{row.party_name}</span>,
      },
      {
        id: 'receipt_date',
        header: 'Fecha',
        sortable: true,
        cell: (row) => dateShort(row.receipt_date),
      },
      {
        id: 'reference',
        header: 'Guía',
        cell: (row) =>
          row.reference ? (
            <span className="font-mono text-xs">{row.reference}</span>
          ) : (
            <span className="text-fg-subtle">—</span>
          ),
      },
      {
        id: 'order_number',
        header: 'Orden',
        cell: (row) =>
          row.order_number ? (
            <span className="font-mono text-xs">{row.order_number}</span>
          ) : (
            <span className="text-fg-subtle">Sin orden</span>
          ),
      },
      {
        id: 'status',
        header: 'Estado',
        sortable: true,
        cell: (row) => {
          const status = RECEIPT_STATUS[row.status];
          return (
            <Badge tone={status?.tone ?? 'neutral'} dot>
              {status?.label ?? row.status}
            </Badge>
          );
        },
      },
      {
        id: 'line_count',
        header: 'Líneas',
        numeric: true,
        cell: (row) => number(row.line_count),
      },
      {
        id: 'total_cost',
        header: 'Costo',
        numeric: true,
        cell: (row) => money(row.total_cost),
      },
    ],
    [],
  );

  const filterValue = (field: string): string =>
    (table.state.filters.find((f) => f.field === field)?.value as string | undefined) ?? '';

  return (
    <>
      <PageHeader
        title="Recepciones"
        description="Lo que llegó de verdad a la bodega"
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
        onRowClick={(row) => navigate(`/compras/recepciones/${row.id}`)}
        can={can}
        searchPlaceholder="Buscar por número, proveedor o guía…"
        emptyTitle="Todavía no ha llegado mercancía"
        emptyDescription="Las recepciones se crean desde una orden de compra cuando llega el pedido."
        filters={
          <Select
            value={filterValue('status')}
            onChange={(e) => table.setFilter('status', 'eq', e.target.value || null)}
            className="h-9 w-auto"
            aria-label="Filtrar por estado"
          >
            <option value="">Todos los estados</option>
            {Object.entries(RECEIPT_STATUS).map(([value, { label }]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        }
      />

      <p className="flex items-start gap-2 text-xs text-fg-subtle">
        <PackageCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <span>
          Contabilizar una recepción es lo que sube el stock y fija el costo. Anularla devuelve la
          mercancía con un movimiento propio, para que el kardex pueda contar lo que pasó.
        </span>
      </p>
    </>
  );
}

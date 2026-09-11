import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Badge, Button, PageHeader, Select } from '@/design-system';
import { DataTable, type Column } from '@/design-system/data/DataTable';
import { useTableState } from '@/lib/url/useTableState';
import { useCollection, useList } from '@/lib/api/useList';
import { Can, useCan } from '@/lib/authz/useCan';
import { amount, dateShort } from '@/lib/format';
import { ENTRY_STATUS, JOURNAL_TYPE, SOURCE_LABEL } from '../lib/labels';
import type { EntryRow, JournalRow } from '../lib/types';

/**
 * Libro diario.
 *
 * Cada fila dice de dónde salió el asiento. Es la mitad del valor de tener
 * contabilidad automática: sin el origen a la vista, cuadrar un mes obliga a
 * buscar la factura a mano por fecha e importe, y con cuatrocientas facturas
 * eso significa no hacerlo.
 */
export function JournalPage() {
  const table = useTableState({ defaultSort: [{ field: 'entry_date', dir: 'desc' }] });
  const can = useCan();
  const navigate = useNavigate();

  const query = useList<EntryRow>('/accounting/entries', table.toQuery());
  const journals = useCollection<JournalRow>('/accounting/journals');

  const columns = useMemo<Column<EntryRow>[]>(
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
        id: 'entry_date',
        header: 'Fecha',
        sortable: true,
        cell: (row) => dateShort(row.entry_date),
      },
      {
        id: 'journal_code',
        header: 'Diario',
        sortable: true,
        cell: (row) => (
          <div className="min-w-0">
            <div className="truncate">{row.journal_name}</div>
            <div className="font-mono text-xs text-fg-subtle">{row.journal_code}</div>
          </div>
        ),
      },
      {
        id: 'memo',
        header: 'Concepto',
        sortable: true,
        cell: (row) => <span className="line-clamp-2">{row.memo}</span>,
      },
      {
        id: 'source_type',
        header: 'Origen',
        cell: (row) => (
          <span className="text-xs text-fg-muted">
            {SOURCE_LABEL[row.source_type] ?? row.source_type}
          </span>
        ),
      },
      {
        id: 'status',
        header: 'Estado',
        sortable: true,
        cell: (row) => (
          <div className="flex flex-wrap items-center gap-1">
            <Badge tone={ENTRY_STATUS[row.status]?.tone ?? 'neutral'} dot>
              {ENTRY_STATUS[row.status]?.label ?? row.status}
            </Badge>
            {row.is_reversed && <Badge tone="warning">Reversado</Badge>}
            {row.reversal_of_id && <Badge tone="info">Reversión</Badge>}
          </div>
        ),
      },
      {
        id: 'debit_total',
        header: 'Importe',
        numeric: true,
        sortable: true,
        cell: (row) => amount(row.debit_total, 0),
      },
      {
        id: 'period_name',
        header: 'Periodo',
        hiddenByDefault: true,
        cell: (row) => row.period_name,
      },
    ],
    [],
  );

  const filterValue = (field: string): string =>
    (table.state.filters.find((f) => f.field === field)?.value as string | undefined) ?? '';

  return (
    <>
      <PageHeader
        title="Libro diario"
        description="Todos los asientos, con el documento que los originó"
        actions={
          <Can perm="accounting:entry:create">
            <Button
              variant="primary"
              icon={<Plus className="size-4" />}
              onClick={() => navigate('/contabilidad/asientos/nuevo')}
            >
              Asiento manual
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
        onRowClick={(row) => navigate(`/contabilidad/asientos/${row.id}`)}
        can={can}
        searchPlaceholder="Buscar por número o concepto…"
        emptyTitle="Todavía no hay asientos"
        emptyDescription="Los asientos aparecen solos al emitir facturas y registrar cobros."
        aggregateLabels={{
          debit_sum: { label: 'Total débitos', as: 'money' },
          credit_sum: { label: 'Total créditos', as: 'money' },
          drafts: 'Borradores',
        }}
        filters={
          <Select
            value={filterValue('journal_id')}
            onChange={(e) => table.setFilter('journal_id', 'eq', e.target.value || null)}
            className="h-9 w-auto"
            aria-label="Filtrar por diario"
          >
            <option value="">Todos los diarios</option>
            {(journals.data?.items ?? []).map((journal) => (
              <option key={journal.id} value={journal.id}>
                {JOURNAL_TYPE[journal.type] ?? journal.name}
              </option>
            ))}
          </Select>
        }
      />
    </>
  );
}

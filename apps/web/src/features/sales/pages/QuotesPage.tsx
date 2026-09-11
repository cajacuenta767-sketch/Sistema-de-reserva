import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Plus, Send, XCircle } from 'lucide-react';
import { Badge, Button, PageHeader, Select } from '@/design-system';
import { DataTable, type Column } from '@/design-system/data/DataTable';
import { useTableState } from '@/lib/url/useTableState';
import { useList } from '@/lib/api/useList';
import { post } from '@/lib/api/client';
import { Can, useCan } from '@/lib/authz/useCan';
import { useToast } from '@/store/toast';
import { dateShort, money } from '@/lib/format';
import { QuoteEditorDialog } from '../components/QuoteEditorDialog';
import { QUOTE_STATUS } from '../lib/labels';
import type { QuoteRow } from '../lib/types';

export function QuotesPage() {
  const table = useTableState({ defaultSort: [{ field: 'issue_date', dir: 'desc' }] });
  const can = useCan();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);

  const query = useList<QuoteRow>('/quotes', table.toQuery());
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['/quotes'] });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => post(`/quotes/${id}/status`, { status }),
    onSuccess: () => {
      toast.success('Estado actualizado');
      invalidate();
    },
    onError: toast.error,
  });

  const convert = useMutation({
    mutationFn: (id: string) => post<{ invoice: { id: string } }>(`/quotes/${id}/convert`),
    onSuccess: (detail) => {
      toast.success('Factura creada con el precio cotizado');
      invalidate();
      navigate(`/facturas/${detail.invoice.id}`);
    },
    onError: toast.error,
  });

  const columns = useMemo<Column<QuoteRow>[]>(
    () => [
      {
        id: 'number',
        header: 'Número',
        sortable: true,
        primary: true,
        cell: (row) => <span className="font-mono text-xs">{row.number}</span>,
      },
      { id: 'party_name', header: 'Cliente', sortable: true, cell: (row) => row.party_name },
      { id: 'issue_date', header: 'Fecha', sortable: true, cell: (row) => dateShort(row.issue_date) },
      {
        id: 'valid_until',
        header: 'Válida hasta',
        sortable: true,
        cell: (row) => (row.valid_until ? dateShort(row.valid_until) : 'Sin límite'),
      },
      {
        id: 'status',
        header: 'Estado',
        sortable: true,
        cell: (row) => {
          const status = QUOTE_STATUS[row.status];
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
    ],
    [],
  );

  return (
    <>
      <PageHeader
        title="Cotizaciones"
        description="Lo que has ofrecido y en qué quedó"
        actions={
          <Can perm="sales:quote:create">
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              Nueva cotización
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
        onRowClick={(row) =>
          row.converted_invoice_id ? navigate(`/facturas/${row.converted_invoice_id}`) : undefined
        }
        can={can}
        searchPlaceholder="Buscar por número o cliente…"
        emptyTitle="Sin cotizaciones"
        emptyDescription="Prepara una oferta y conviértela en factura cuando la acepten."
        aggregateLabels={{ total_amount: 'Total cotizado', accepted: 'Aceptadas', converted: 'Facturadas' }}
        filters={
          <Select
            value={(table.state.filters.find((f) => f.field === 'status')?.value as string | undefined) ?? ''}
            onChange={(e) => table.setFilter('status', 'eq', e.target.value || null)}
            className="h-9 w-auto"
            aria-label="Filtrar por estado"
          >
            <option value="">Todos los estados</option>
            {Object.entries(QUOTE_STATUS).map(([value, { label }]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        }
        rowActions={[
          {
            label: 'Marcar como enviada',
            icon: <Send className="size-4" />,
            hidden: (row) => row.status !== 'DRAFT' || !can('sales:quote:update'),
            onRun: (row) => setStatus.mutate({ id: row.id, status: 'SENT' }),
          },
          {
            label: 'Marcar como aceptada',
            icon: <CheckCircle2 className="size-4" />,
            hidden: (row) => !['DRAFT', 'SENT'].includes(row.status) || !can('sales:quote:update'),
            onRun: (row) => setStatus.mutate({ id: row.id, status: 'ACCEPTED' }),
          },
          {
            label: 'Convertir en factura',
            icon: <ArrowRight className="size-4" />,
            hidden: (row) => row.status !== 'ACCEPTED' || !can('sales:invoice:create'),
            onRun: (row) => convert.mutate(row.id),
          },
          {
            label: 'Marcar como rechazada',
            icon: <XCircle className="size-4" />,
            destructive: true,
            hidden: (row) =>
              !['DRAFT', 'SENT', 'ACCEPTED'].includes(row.status) || !can('sales:quote:update'),
            onRun: (row) => setStatus.mutate({ id: row.id, status: 'REJECTED' }),
          },
        ]}
      />

      {creating && (
        <QuoteEditorDialog
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            invalidate();
          }}
        />
      )}
    </>
  );
}

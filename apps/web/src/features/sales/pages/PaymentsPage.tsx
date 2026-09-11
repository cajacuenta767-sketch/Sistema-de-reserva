import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Ban, Plus } from 'lucide-react';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  Field,
  PageHeader,
  Select,
  Textarea,
} from '@/design-system';
import { DataTable, type Column } from '@/design-system/data/DataTable';
import { useTableState } from '@/lib/url/useTableState';
import { useList } from '@/lib/api/useList';
import { post } from '@/lib/api/client';
import { Can, useCan } from '@/lib/authz/useCan';
import { useToast } from '@/store/toast';
import { dateShort, money } from '@/lib/format';
import { PaymentDialog } from '../components/PaymentDialog';
import { PartyPicker } from '../components/PartyPicker';
import { PAYMENT_METHODS, paymentMethodLabel } from '../lib/labels';
import type { PaymentRow } from '../lib/types';

export function PaymentsPage() {
  const table = useTableState({ defaultSort: [{ field: 'payment_date', dir: 'desc' }] });
  const can = useCan();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [choosingParty, setChoosingParty] = useState(false);
  const [partyForPayment, setPartyForPayment] = useState<string | null>(null);
  const [voiding, setVoiding] = useState<PaymentRow | null>(null);

  const query = useList<PaymentRow>('/payments', table.toQuery());
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['/payments'] });
    void queryClient.invalidateQueries({ queryKey: ['/invoices'] });
  };

  const columns = useMemo<Column<PaymentRow>[]>(
    () => [
      {
        id: 'number',
        header: 'Recibo',
        sortable: true,
        primary: true,
        cell: (row) => (
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs">{row.number ?? '—'}</span>
            {row.voided_at && <Badge tone="neutral">Anulado</Badge>}
          </div>
        ),
      },
      { id: 'party_name', header: 'Cliente', sortable: true, cell: (row) => row.party_name },
      { id: 'payment_date', header: 'Fecha', sortable: true, cell: (row) => dateShort(row.payment_date) },
      {
        id: 'method',
        header: 'Medio',
        sortable: true,
        cell: (row) => paymentMethodLabel(row.method),
      },
      {
        id: 'amount',
        header: 'Importe',
        numeric: true,
        sortable: true,
        cell: (row) => money(row.amount, row.currency_code),
      },
      {
        id: 'unapplied',
        header: 'Sin imputar',
        numeric: true,
        sortable: true,
        // El dinero que entró y no se sabe a qué factura corresponde: es lo
        // primero que busca quien cuadra la cartera.
        cell: (row) =>
          Number(row.unapplied) > 0 ? (
            <span className="font-medium text-warning-fg">{money(row.unapplied, row.currency_code)}</span>
          ) : (
            <span className="text-fg-subtle">—</span>
          ),
      },
      {
        id: 'reference',
        header: 'Referencia',
        sortable: false,
        hiddenByDefault: true,
        cell: (row) => row.reference ?? '—',
      },
    ],
    [],
  );

  return (
    <>
      <PageHeader
        title="Cobros"
        description="El dinero recibido y a qué facturas se aplicó"
        actions={
          <Can perm="sales:payment:create">
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setChoosingParty(true)}>
              Registrar cobro
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
        searchPlaceholder="Buscar por recibo, cliente o referencia…"
        emptyTitle="Sin cobros registrados"
        emptyDescription="Registra el dinero que recibes para que la cartera refleje la realidad."
        aggregateLabels={{ total_amount: 'Total cobrado', unapplied_amount: 'Sin imputar' }}
        filters={
          <Select
            value={(table.state.filters.find((f) => f.field === 'method')?.value as string | undefined) ?? ''}
            onChange={(e) => table.setFilter('method', 'eq', e.target.value || null)}
            className="h-9 w-auto"
            aria-label="Filtrar por medio de pago"
          >
            <option value="">Cualquier medio</option>
            {PAYMENT_METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </Select>
        }
        rowActions={[
          {
            label: 'Anular',
            icon: <Ban className="size-4" />,
            destructive: true,
            hidden: (row) => Boolean(row.voided_at) || !can('sales:payment:void'),
            onRun: (row) => setVoiding(row),
          },
        ]}
      />

      {choosingParty && (
        <ChoosePartyDialog
          onClose={() => setChoosingParty(false)}
          onChosen={(id) => {
            setChoosingParty(false);
            setPartyForPayment(id);
          }}
        />
      )}

      {partyForPayment && (
        <PaymentDialog
          partyId={partyForPayment}
          onClose={() => setPartyForPayment(null)}
          onDone={() => {
            setPartyForPayment(null);
            invalidate();
          }}
        />
      )}

      {voiding && (
        <VoidPaymentDialog
          payment={voiding}
          onClose={() => setVoiding(null)}
          onDone={() => {
            setVoiding(null);
            invalidate();
            toast.success('Cobro anulado; las facturas recuperaron su saldo');
          }}
        />
      )}
    </>
  );
}

function ChoosePartyDialog({ onClose, onChosen }: { onClose: () => void; onChosen: (id: string) => void }) {
  const [partyId, setPartyId] = useState('');
  const [partyName, setPartyName] = useState('');

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title="¿De quién es el cobro?"
        size="sm"
        footer={
          <>
            <Button onClick={onClose}>Cancelar</Button>
            <Button variant="primary" disabled={!partyId} onClick={() => onChosen(partyId)}>
              Continuar
            </Button>
          </>
        }
      >
        <Field label="Cliente" required>
          {(props) => (
            <PartyPicker
              {...props}
              value={partyId}
              label={partyName}
              onPick={(party) => {
                setPartyId(party.id);
                setPartyName(party.display_name);
              }}
            />
          )}
        </Field>
      </DialogContent>
    </Dialog>
  );
}

function VoidPaymentDialog({
  payment,
  onClose,
  onDone,
}: {
  payment: PaymentRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const run = useMutation({
    mutationFn: () => post(`/payments/${payment.id}/void`, { reason: reason.trim() }),
    onSuccess: onDone,
    onError: toast.error,
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={`Anular el cobro ${payment.number ?? ''}`}
        description="El cobro no se borra: queda anulado y las facturas recuperan su saldo. Borrarlo dejaría un movimiento de banco sin explicación."
        size="sm"
        footer={
          <>
            <Button onClick={onClose}>Cancelar</Button>
            <Button
              variant="danger"
              loading={run.isPending}
              onClick={() => {
                if (reason.trim().length < 3) {
                  setError('Escribe el motivo: queda en la auditoría');
                  return;
                }
                setError('');
                run.mutate();
              }}
            >
              Anular
            </Button>
          </>
        }
      >
        <Field label="Motivo" required error={error}>
          {(props) => (
            <Textarea
              {...props}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Cheque devuelto, cobro duplicado…"
            />
          )}
        </Field>
      </DialogContent>
    </Dialog>
  );
}

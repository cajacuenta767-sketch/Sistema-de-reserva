import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Ban, Pencil, Printer, Send, Wallet } from 'lucide-react';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  ErrorState,
  Field,
  PageHeader,
  PageLoader,
  StatTile,
  Textarea,
} from '@/design-system';
import { useResource } from '@/lib/api/useList';
import { post } from '@/lib/api/client';
import { Can } from '@/lib/authz/useCan';
import { useToast } from '@/store/toast';
import { amount, date, dateShort, money } from '@/lib/format';
import { PaymentDialog } from '../components/PaymentDialog';
import { INVOICE_STATUS } from '../lib/labels';
import type { InvoiceDetail } from '../lib/types';

export function InvoiceDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [voiding, setVoiding] = useState(false);
  const [paying, setPaying] = useState(false);

  const query = useResource<InvoiceDetail>(`/invoices/${id}`);
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: [`/invoices/${id}`] });
    void queryClient.invalidateQueries({ queryKey: ['/invoices'] });
  };

  const issue = useMutation({
    mutationFn: () => post<InvoiceDetail>(`/invoices/${id}/issue`),
    onSuccess: (detail) => {
      toast.success(`Factura ${detail.invoice.number} emitida`);
      invalidate();
    },
    onError: toast.error,
  });

  if (query.isLoading) return <PageLoader />;
  if (query.error || !query.data) {
    return (
      <ErrorState
        title="No se pudo cargar la factura"
        description={(query.error as Error | null)?.message}
        action={<Button onClick={() => void query.refetch()}>Reintentar</Button>}
      />
    );
  }

  const { invoice, effectiveStatus, outstanding, lines, withholdings, payments } = query.data;
  const status = INVOICE_STATUS[effectiveStatus];
  const isDraft = invoice.status === 'DRAFT';
  const currency = invoice.currencyCode;

  return (
    <>
      <PageHeader
        title={invoice.number ?? 'Borrador de factura'}
        description={`Emitida el ${date(invoice.issueDate)} · vence el ${date(invoice.dueDate)}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button icon={<ArrowLeft className="size-4" />} onClick={() => navigate('/facturas')}>
              Volver
            </Button>
            {isDraft && (
              <>
                <Can perm="sales:invoice:update">
                  <Button icon={<Pencil className="size-4" />} onClick={() => navigate(`/facturas/${id}/editar`)}>
                    Editar
                  </Button>
                </Can>
                <Can perm="sales:invoice:issue">
                  <Button
                    variant="primary"
                    icon={<Send className="size-4" />}
                    loading={issue.isPending}
                    onClick={() => issue.mutate()}
                  >
                    Emitir
                  </Button>
                </Can>
              </>
            )}
            {!isDraft && invoice.status !== 'VOID' && Number(outstanding) > 0 && (
              <Can perm="sales:payment:create">
                <Button variant="primary" icon={<Wallet className="size-4" />} onClick={() => setPaying(true)}>
                  Registrar cobro
                </Button>
              </Can>
            )}
            {invoice.status !== 'VOID' && (
              <Can perm="sales:invoice:void">
                <Button icon={<Ban className="size-4" />} onClick={() => setVoiding(true)}>
                  Anular
                </Button>
              </Can>
            )}
            {!isDraft && (
              <Button icon={<Printer className="size-4" />} onClick={() => window.print()}>
                Imprimir
              </Button>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={status.tone} dot>
          {status.label}
        </Badge>
        {isDraft && (
          <span className="text-sm text-fg-muted">
            Todavía no consume consecutivo: el número se asigna al emitir.
          </span>
        )}
        {invoice.voidReason && <span className="text-sm text-danger-fg">Anulada: {invoice.voidReason}</span>}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Total de la factura" value={money(invoice.total, currency)} tone="accent" />
        <StatTile label="Pagado" value={money(invoice.paidTotal, currency)} tone="success" />
        <StatTile
          label="Saldo"
          value={money(outstanding, currency)}
          tone={Number(outstanding) > 0 ? 'warning' : 'success'}
        />
        <StatTile
          label="A transferir"
          hint={Number(invoice.withholdingTotal) > 0 ? 'Total menos retenciones' : 'Sin retenciones'}
          value={money(invoice.netPayable, currency)}
        />
      </div>

      <section className="card overflow-x-auto">
        <table className="w-full min-w-[40rem] text-sm">
          <caption className="sr-only">Líneas de la factura</caption>
          <thead className="bg-surface-2 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Concepto</th>
              <th className="px-3 py-2 text-right font-medium">Cantidad</th>
              <th className="px-3 py-2 text-right font-medium">Precio</th>
              <th className="px-3 py-2 text-right font-medium">Dto.</th>
              <th className="px-3 py-2 font-medium">Impuesto</th>
              <th className="px-3 py-2 text-right font-medium">Importe</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {lines.map((line) => (
              <tr key={line.id}>
                <td className="px-3 py-2">
                  <div className="font-medium">{line.description}</div>
                  {line.sku && <div className="font-mono text-xs text-fg-subtle">{line.sku}</div>}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {amount(line.quantity, 2)} {line.uomCode ?? ''}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{money(line.unitPrice, currency)}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {Number(line.discountPercent) > 0 ? `${amount(line.discountPercent, 2)} %` : '—'}
                </td>
                <td className="px-3 py-2">
                  {line.taxes.length > 0
                    ? line.taxes.map((t) => `${t.code} ${t.rate} %`).join(', ')
                    : <span className="text-fg-subtle">Sin impuesto</span>}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{money(line.subtotal, currency)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-border">
            <Total label="Base gravable" value={money(invoice.subtotal, currency)} />
            {Number(invoice.discountTotal) > 0 && (
              <Total label="Descuentos" value={`− ${money(invoice.discountTotal, currency)}`} />
            )}
            <Total label="Impuestos" value={money(invoice.taxTotal, currency)} />
            <Total label="Total" value={money(invoice.total, currency)} strong />
            {withholdings
              .filter((w) => Number(w.amount) > 0)
              .map((w) => (
                <Total key={w.code} label={`${w.name} (${w.rate} %)`} value={`− ${money(w.amount, currency)}`} />
              ))}
            {Number(invoice.withholdingTotal) > 0 && (
              <Total label="A transferir" value={money(invoice.netPayable, currency)} strong />
            )}
          </tfoot>
        </table>
      </section>

      {withholdings.some((w) => Number(w.amount) === 0) && (
        <section className="card space-y-2 p-4">
          <h2 className="text-sm font-semibold">Retenciones no practicadas</h2>
          <ul className="space-y-1 text-sm text-fg-muted">
            {withholdings
              .filter((w) => Number(w.amount) === 0)
              .map((w) => (
                <li key={w.code}>
                  <strong className="text-fg">{w.name}</strong>: la base del documento no alcanza el mínimo
                  legal.
                </li>
              ))}
          </ul>
        </section>
      )}

      {payments.length > 0 && (
        <section className="card space-y-2 p-4">
          <h2 className="text-sm font-semibold">Cobros aplicados</h2>
          <ul className="divide-y divide-border text-sm">
            {payments.map((p) => (
              <li key={p.paymentId} className="flex items-center justify-between gap-3 py-2">
                <span>
                  <span className="font-mono text-xs">{p.number ?? '—'}</span>
                  <span className="ml-2 text-fg-muted">{dateShort(p.paymentDate)}</span>
                </span>
                <span className="tabular-nums">{money(p.amount, currency)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {invoice.notes && (
        <section className="card space-y-2 p-4">
          <h2 className="text-sm font-semibold">Notas</h2>
          <p className="text-sm whitespace-pre-wrap text-fg-muted">{invoice.notes}</p>
        </section>
      )}

      {voiding && (
        <VoidDialog
          invoiceId={id}
          hasPayments={Number(invoice.paidTotal) > 0}
          onClose={() => setVoiding(false)}
          onDone={() => {
            setVoiding(false);
            invalidate();
          }}
        />
      )}

      {paying && (
        <PaymentDialog
          partyId={invoice.partyId}
          invoiceId={id}
          onClose={() => setPaying(false)}
          onDone={() => {
            setPaying(false);
            invalidate();
          }}
        />
      )}
    </>
  );
}

function Total({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <tr className={strong ? 'font-semibold' : ''}>
      <td className="px-3 py-1.5 text-right text-fg-muted" colSpan={5}>
        {label}
      </td>
      <td className="px-3 py-1.5 text-right tabular-nums">{value}</td>
    </tr>
  );
}

function VoidDialog({
  invoiceId,
  hasPayments,
  onClose,
  onDone,
}: {
  invoiceId: string;
  hasPayments: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const run = useMutation({
    mutationFn: () => post(`/invoices/${invoiceId}/void`, { reason: reason.trim() }),
    onSuccess: () => {
      toast.success('Factura anulada');
      onDone();
    },
    onError: toast.error,
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title="Anular la factura"
        description={
          hasPayments
            ? 'Esta factura tiene cobros registrados: no se puede anular, hay que emitir una nota de crédito.'
            : 'El motivo queda en la auditoría. Una factura anulada conserva su consecutivo.'
        }
        size="sm"
        footer={
          <>
            <Button onClick={onClose}>Cancelar</Button>
            <Button
              variant="danger"
              loading={run.isPending}
              disabled={hasPayments}
              onClick={() => {
                if (reason.trim().length < 3) {
                  setError('Escribe el motivo: queda registrado en la auditoría');
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
              disabled={hasPayments}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Datos del cliente equivocados, duplicada…"
            />
          )}
        </Field>
      </DialogContent>
    </Dialog>
  );
}

import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, BookText, Check, X } from 'lucide-react';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  ErrorState,
  Field,
  PageHeader,
  PageLoader,
  Textarea,
} from '@/design-system';
import { post } from '@/lib/api/client';
import { useResource } from '@/lib/api/useList';
import { Can } from '@/lib/authz/useCan';
import { useToast } from '@/store/toast';
import { amount, date, money } from '@/lib/format';
import { BILL_STATUS } from '../lib/labels';

interface BillDetail {
  bill: {
    id: string;
    number: string | null;
    supplierNumber: string;
    status: 'DRAFT' | 'POSTED' | 'VOID';
    issueDate: string;
    dueDate: string;
    currencyCode: string;
    subtotal: string;
    taxTotal: string;
    total: string;
    withholdingTotal: string;
    netPayable: string;
    paidTotal: string;
    notes: string | null;
  };
  partyName: string;
  lines: Array<{
    id: string;
    description: string;
    quantity: string;
    unitPrice: string;
    subtotal: string;
    taxTotal: string;
    total: string;
  }>;
  withholdings: Array<{ code: string; name: string; rate: string; base: string; amount: string }>;
  outstanding: string;
  effectiveStatus: string;
}

export function BillDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const query = useResource<BillDetail>(`/purchasing/bills/${id}`);
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState('');

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: [`/purchasing/bills/${id}`] });
    void queryClient.invalidateQueries({ queryKey: ['/purchasing/bills'] });
  };

  const postBill = useMutation({
    mutationFn: () => post(`/purchasing/bills/${id}/post`),
    onSuccess: () => {
      toast.success('Factura contabilizada: ya cuenta en las cuentas por pagar');
      invalidate();
    },
    onError: toast.error,
  });

  const voidBill = useMutation({
    mutationFn: () => post(`/purchasing/bills/${id}/void`, { reason: reason.trim() }),
    onSuccess: () => {
      toast.success('Factura anulada');
      setVoiding(false);
      setReason('');
      invalidate();
    },
    onError: toast.error,
  });

  if (query.isLoading) return <PageLoader />;
  if (query.error || !query.data) {
    return (
      <ErrorState
        title="No se pudo cargar la factura"
        description={(query.error as Error | null)?.message ?? 'No existe'}
        action={<Button onClick={() => navigate('/compras/facturas')}>Volver</Button>}
      />
    );
  }

  const { bill, partyName, lines, withholdings, outstanding, effectiveStatus } = query.data;
  const status = BILL_STATUS[effectiveStatus];

  return (
    <>
      <PageHeader
        title={bill.supplierNumber}
        description={`${partyName}${bill.number ? ` · interno ${bill.number}` : ''}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              icon={<ArrowLeft className="size-4" />}
              onClick={() => navigate('/compras/facturas')}
            >
              Facturas
            </Button>
            {bill.status === 'DRAFT' && (
              <Can perm="purchasing:bill:post">
                <Button
                  variant="primary"
                  icon={<Check className="size-4" />}
                  loading={postBill.isPending}
                  onClick={() => postBill.mutate()}
                >
                  Contabilizar
                </Button>
              </Can>
            )}
            {bill.status !== 'VOID' && (
              <Can perm="purchasing:bill:void">
                <Button variant="ghost" icon={<X className="size-4" />} onClick={() => setVoiding(true)}>
                  Anular
                </Button>
              </Can>
            )}
            {bill.status === 'POSTED' && (
              <Can perm="accounting:entry:read">
                <Link
                  to={`/contabilidad/diario?filter[source_id]=${bill.id}`}
                  className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-control)] px-3 text-sm text-accent hover:bg-surface-2"
                >
                  <BookText className="size-4" aria-hidden="true" />
                  Ver contabilización
                </Link>
              </Can>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Badge tone={status?.tone ?? 'neutral'} dot>
          {status?.label ?? effectiveStatus}
        </Badge>
        <span className="text-fg-muted">Emitida el {date(bill.issueDate)}</span>
        <span className="text-fg-subtle">·</span>
        <span className="text-fg-muted">Vence el {date(bill.dueDate)}</span>
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[38rem] text-sm">
          <caption className="sr-only">Líneas de la factura</caption>
          <thead className="bg-surface-2 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Concepto</th>
              <th className="px-3 py-2 text-right font-medium">Cantidad</th>
              <th className="px-3 py-2 text-right font-medium">Precio</th>
              <th className="px-3 py-2 text-right font-medium">Base</th>
              <th className="px-3 py-2 text-right font-medium">IVA</th>
              <th className="px-3 py-2 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {lines.map((line) => (
              <tr key={line.id}>
                <td className="px-3 py-2">{line.description}</td>
                <td className="px-3 py-2 text-right tabular-nums">{amount(line.quantity, 0)}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {money(line.unitPrice, bill.currencyCode)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {money(line.subtotal, bill.currencyCode)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {money(line.taxTotal, bill.currencyCode)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {money(line.total, bill.currencyCode)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {withholdings.length > 0 && (
          <section className="card min-w-0 p-0">
            <h2 className="border-b border-border px-3 py-2 text-sm font-medium">
              Retenciones practicadas
            </h2>
            <table className="w-full text-sm">
              <caption className="sr-only">Retenciones de la factura</caption>
              <tbody className="divide-y divide-border">
                {withholdings.map((w) => (
                  <tr key={w.code}>
                    <td className="px-3 py-2">
                      {w.name} <span className="text-fg-subtle">({w.rate} %)</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {money(w.amount, bill.currencyCode)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="border-t border-border px-3 py-2 text-xs text-fg-subtle">
              No son un menor gasto: son una deuda con la DIAN que hay que consignar.
            </p>
          </section>
        )}

        <section className="card min-w-0">
          <dl className="grid gap-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-fg-muted">Base gravable</dt>
              <dd className="tabular-nums">{money(bill.subtotal, bill.currencyCode)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-fg-muted">IVA descontable</dt>
              <dd className="tabular-nums">{money(bill.taxTotal, bill.currencyCode)}</dd>
            </div>
            <div className="flex justify-between border-t border-border pt-2 font-medium">
              <dt>Total de la factura</dt>
              <dd className="tabular-nums">{money(bill.total, bill.currencyCode)}</dd>
            </div>
            {Number(bill.withholdingTotal) > 0 && (
              <>
                <div className="flex justify-between">
                  <dt className="text-fg-muted">Menos retenciones</dt>
                  <dd className="tabular-nums">−{money(bill.withholdingTotal, bill.currencyCode)}</dd>
                </div>
                <div className="flex justify-between font-medium">
                  <dt>Neto a transferir</dt>
                  <dd className="tabular-nums">{money(bill.netPayable, bill.currencyCode)}</dd>
                </div>
              </>
            )}
            <div className="flex justify-between border-t border-border pt-2 text-base font-semibold">
              <dt>Saldo pendiente</dt>
              <dd className="tabular-nums">{money(outstanding, bill.currencyCode)}</dd>
            </div>
          </dl>
        </section>
      </div>

      <Dialog open={voiding} onOpenChange={setVoiding}>
        <DialogContent title="Anular la factura" description={bill.supplierNumber}>
          <div className="grid gap-3">
            <Field label="Motivo" required>
              {(props) => (
                <Textarea
                  {...props}
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              )}
            </Field>
            <p className="text-xs text-fg-muted">
              Si ya estaba contabilizada, su asiento se reversa: no se borra.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setVoiding(false)}>
                Volver
              </Button>
              <Button
                variant="danger"
                loading={voidBill.isPending}
                disabled={!reason.trim()}
                onClick={() => voidBill.mutate()}
              >
                Anular
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

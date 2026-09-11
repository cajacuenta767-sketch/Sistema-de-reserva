import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Dialog, DialogContent, Field, Input, Select, Spinner } from '@/design-system';
import { useCollection } from '@/lib/api/useList';
import { post } from '@/lib/api/client';
import { useToast } from '@/store/toast';
import { dateShort, money } from '@/lib/format';
import { PAYMENT_METHODS } from '../lib/labels';
import type { OpenInvoice } from '../lib/types';

/**
 * Registro de un cobro.
 *
 * Muestra las facturas abiertas del cliente y deja repartir el dinero. Por
 * defecto se imputa de la más antigua a la más reciente, que es lo que evita que
 * una factura envejezca mientras se pagan las nuevas; quien necesite otra cosa
 * reparte a mano.
 */
export function PaymentDialog({
  partyId,
  invoiceId,
  onClose,
  onDone,
}: {
  partyId: string;
  /** Cuando se abre desde una factura, se preselecciona su saldo. */
  invoiceId?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const open = useCollection<OpenInvoice>(`/parties/${partyId}/open-invoices`);

  // Los valores por defecto se DERIVAN de la factura que se está cobrando; no se
  // copian a estado al cargar. Escribir estado durante el render o desde un
  // efecto crea un segundo origen de verdad que se desincroniza en cuanto llegan
  // datos nuevos, y aquí basta con recordar lo que el usuario haya tecleado.
  const [typedAmount, setTypedAmount] = useState<string | null>(null);
  const [typedManual, setTypedManual] = useState<Record<string, string> | null>(null);
  const [method, setMethod] = useState('TRANSFER');
  const [paymentDate, setPaymentDate] = useState('');
  const [reference, setReference] = useState('');
  const [useManual, setUseManual] = useState(Boolean(invoiceId));
  const [error, setError] = useState('');

  const invoices = open.data?.items ?? [];
  const target = invoiceId ? invoices.find((i) => i.id === invoiceId) : undefined;
  const suggested = target ? String(Number(target.outstanding)) : '';

  const amountText = typedAmount ?? suggested;
  const setAmountText = setTypedAmount;
  const manual = typedManual ?? (target ? { [target.id]: suggested } : {});
  const setManual = (updater: (current: Record<string, string>) => Record<string, string>) =>
    setTypedManual(updater(manual));

  const save = useMutation({
    mutationFn: () => {
      const allocations = Object.entries(manual)
        .filter(([, value]) => value.trim() && Number(value.replace(',', '.')) > 0)
        .map(([id, value]) => ({ invoiceId: id, amount: value.replace(',', '.') }));

      return post('/payments', {
        partyId,
        amount: amountText.replace(',', '.'),
        method,
        ...(paymentDate ? { paymentDate } : {}),
        ...(reference.trim() ? { reference: reference.trim() } : {}),
        ...(useManual && allocations.length > 0 ? { allocations } : {}),
      });
    },
    onSuccess: () => {
      toast.success('Cobro registrado');
      void queryClient.invalidateQueries({ queryKey: ['/payments'] });
      void queryClient.invalidateQueries({ queryKey: ['/invoices'] });
      onDone();
    },
    onError: toast.error,
  });

  const submit = () => {
    if (!amountText.trim() || Number(amountText.replace(',', '.')) <= 0) {
      setError('Escribe el importe recibido');
      return;
    }
    setError('');
    save.mutate();
  };

  const assigned = Object.values(manual).reduce((acc, v) => acc + (Number(v.replace(',', '.')) || 0), 0);
  const received = Number(amountText.replace(',', '.')) || 0;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title="Registrar cobro"
        description="Sin reparto manual se aplica a las facturas más antiguas primero."
        size="lg"
        footer={
          <>
            <Button onClick={onClose}>Cancelar</Button>
            <Button variant="primary" loading={save.isPending} onClick={submit}>
              Registrar
            </Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Importe recibido" required error={error}>
            {(props) => (
              <Input
                {...props}
                inputMode="decimal"
                placeholder="0"
                value={amountText}
                onChange={(e) => setAmountText(e.target.value)}
              />
            )}
          </Field>
          <Field label="Medio de pago">
            {(props) => (
              <Select {...props} value={method} onChange={(e) => setMethod(e.target.value)}>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Fecha del pago">
            {(props) => (
              <Input {...props} type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
            )}
          </Field>
          <Field label="Referencia" hint="Número de transferencia, cheque…">
            {(props) => <Input {...props} value={reference} onChange={(e) => setReference(e.target.value)} />}
          </Field>
        </div>

        <div className="mt-2 space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-[var(--color-accent)]"
              checked={useManual}
              onChange={(e) => setUseManual(e.target.checked)}
            />
            Repartir a mano entre las facturas
          </label>

          {open.isLoading && <Spinner />}

          {invoices.length === 0 && !open.isLoading && (
            <p className="text-sm text-fg-muted">
              Este cliente no tiene facturas pendientes. El cobro quedará como saldo a favor.
            </p>
          )}

          {invoices.length > 0 && (
            <div className="overflow-x-auto rounded-[var(--radius-control)] border border-border">
              <table className="w-full min-w-[30rem] text-sm">
                <thead className="bg-surface-2 text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">Factura</th>
                    <th className="px-3 py-2 font-medium">Vence</th>
                    <th className="px-3 py-2 text-right font-medium">Saldo</th>
                    {useManual && <th className="w-36 px-3 py-2 text-right font-medium">Aplicar</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {invoices.map((invoice) => (
                    <tr key={invoice.id}>
                      <td className="px-3 py-2 font-mono text-xs">{invoice.number ?? '—'}</td>
                      <td className="px-3 py-2">{dateShort(invoice.dueDate)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {money(invoice.outstanding, invoice.currencyCode)}
                      </td>
                      {useManual && (
                        <td className="px-3 py-2">
                          <Input
                            className="text-right"
                            inputMode="decimal"
                            placeholder="0"
                            aria-label={`Importe para la factura ${invoice.number ?? ''}`}
                            value={manual[invoice.id] ?? ''}
                            onChange={(e) =>
                              setManual((current) => ({ ...current, [invoice.id]: e.target.value }))
                            }
                          />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {useManual && assigned > received && (
            <p className="text-sm text-danger-fg" role="alert">
              Estás repartiendo {money(String(assigned))} de un cobro de {money(String(received))}.
            </p>
          )}
          {useManual && received > assigned && assigned > 0 && (
            <p className="text-sm text-fg-muted">
              Quedarán {money(String(received - assigned))} sin imputar, como saldo a favor del cliente.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

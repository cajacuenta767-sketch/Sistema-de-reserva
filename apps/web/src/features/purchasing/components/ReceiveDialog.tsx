import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Dialog, DialogContent, Field, Input } from '@/design-system';
import { post } from '@/lib/api/client';
import { useToast } from '@/store/toast';
import { amount } from '@/lib/format';
import type { OrderDetail } from '../lib/types';

interface Props {
  order: OrderDetail | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}

/**
 * Recibir mercancía de una orden.
 *
 * Arranca con lo PENDIENTE en cada línea, no con lo pedido: si llegó parte del
 * pedido en un despacho anterior, proponer la cantidad original haría que quien
 * recibe tuviera que restar a mano, y una resta mal hecha mete en la bodega
 * mercancía que no llegó.
 */
export function ReceiveDialog({ order, open, onOpenChange, onDone }: Props) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [typed, setTyped] = useState<Record<string, string> | null>(null);
  const [reference, setReference] = useState('');
  const [error, setError] = useState('');

  // Valor derivado: lo pendiente, salvo lo que el usuario haya cambiado.
  const quantities =
    typed ??
    Object.fromEntries((order?.lines ?? []).map((l) => [l.id, l.pending]));

  const save = useMutation({
    mutationFn: () =>
      post('/purchasing/receipts', {
        partyId: order?.order.partyId,
        orderId: order?.order.id,
        warehouseId: order?.order.warehouseId,
        ...(reference.trim() ? { reference: reference.trim() } : {}),
        lines: (order?.lines ?? [])
          .filter((l) => Number((quantities[l.id] ?? '0').replace(',', '.')) > 0)
          .map((l) => ({
            orderLineId: l.id,
            productId: l.productId,
            quantity: (quantities[l.id] ?? '0').replace(',', '.'),
            unitCost: l.unitPrice,
          })),
      }),
    onSuccess: async (created) => {
      const receipt = created as { receipt: { id: string } };
      // Se contabiliza de una vez: un borrador de recepción que nadie
      // contabiliza es mercancía que está en la bodega y no en el sistema.
      await post(`/purchasing/receipts/${receipt.receipt.id}/post`);
      toast.success('Recepción registrada: el inventario ya la refleja');
      void queryClient.invalidateQueries({ queryKey: ['/purchasing/orders'] });
      void queryClient.invalidateQueries({ queryKey: ['/inventory/stock'] });
      setTyped(null);
      setReference('');
      onDone();
    },
    onError: toast.error,
  });

  const pending = (order?.lines ?? []).filter((l) => Number(l.pending) > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Recibir mercancía"
        description={order ? `Orden ${order.order.number ?? ''} · ${order.partyName}` : ''}
      >
        <div className="grid gap-3">
          {pending.length === 0 ? (
            <p className="text-sm text-fg-muted">
              Esta orden ya se recibió completa: no queda nada pendiente.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">Cantidades que llegan</caption>
                  <thead className="bg-surface-2 text-left">
                    <tr>
                      <th className="px-2 py-1.5 font-medium">Producto</th>
                      <th className="px-2 py-1.5 text-right font-medium">Pendiente</th>
                      <th className="px-2 py-1.5 text-right font-medium">Llega</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {pending.map((line) => (
                      <tr key={line.id}>
                        <td className="px-2 py-1.5">{line.description}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-fg-muted">
                          {amount(line.pending, 0)}
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <Input
                            inputMode="decimal"
                            value={quantities[line.id] ?? ''}
                            aria-label={`Cantidad recibida de ${line.description}`}
                            className="ml-auto w-24 text-right tabular-nums"
                            onChange={(e) =>
                              setTyped({ ...quantities, [line.id]: e.target.value })
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <Field label="Guía o remisión" hint="El documento del proveedor, para poder reclamar.">
                {(props) => (
                  <Input
                    {...props}
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder="GUIA-4471"
                  />
                )}
              </Field>

              {error && (
                <p role="alert" className="rounded-[var(--radius-control)] bg-danger-soft p-2 text-sm text-danger-soft-fg">
                  {error}
                </p>
              )}
            </>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            {pending.length > 0 && (
              <Button
                variant="primary"
                loading={save.isPending}
                onClick={() => {
                  const any = pending.some(
                    (l) => Number((quantities[l.id] ?? '0').replace(',', '.')) > 0,
                  );
                  if (!any) return setError('Indica al menos una cantidad recibida');
                  setError('');
                  save.mutate();
                }}
              >
                Recibir
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, CheckCircle2, PackageCheck, Send, X } from 'lucide-react';
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
import { ORDER_STATUS, RECEIPT_STATUS } from '../lib/labels';
import { ReceiveDialog } from '../components/ReceiveDialog';
import type { OrderDetail } from '../lib/types';

export function OrderDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const query = useResource<OrderDetail>(`/purchasing/orders/${id}`);

  const [receiving, setReceiving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: [`/purchasing/orders/${id}`] });
    void queryClient.invalidateQueries({ queryKey: ['/purchasing/orders'] });
  };

  const send = useMutation({
    mutationFn: () => post(`/purchasing/orders/${id}/send`),
    onSuccess: () => {
      toast.success('Orden enviada al proveedor');
      invalidate();
    },
    onError: toast.error,
  });

  const cancel = useMutation({
    mutationFn: () => post(`/purchasing/orders/${id}/cancel`, { reason: reason.trim() }),
    onSuccess: () => {
      toast.success('Orden cancelada');
      setCancelling(false);
      setReason('');
      invalidate();
    },
    onError: toast.error,
  });

  if (query.isLoading) return <PageLoader />;
  if (query.error || !query.data) {
    return (
      <ErrorState
        title="No se pudo cargar la orden"
        description={(query.error as Error | null)?.message ?? 'No existe'}
        action={<Button onClick={() => navigate('/compras/ordenes')}>Volver</Button>}
      />
    );
  }

  const { order, partyName, lines, receipts, match } = query.data;
  const status = ORDER_STATUS[order.status];
  const problemas = match.filter((m) => !m.matches);
  const recibible = order.status === 'SENT' || order.status === 'PARTIAL';

  return (
    <>
      <PageHeader
        title={order.number ?? 'Borrador de orden'}
        description={partyName}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              icon={<ArrowLeft className="size-4" />}
              onClick={() => navigate('/compras/ordenes')}
            >
              Órdenes
            </Button>
            {order.status === 'DRAFT' && (
              <Can perm="purchasing:order:send">
                <Button
                  variant="primary"
                  icon={<Send className="size-4" />}
                  loading={send.isPending}
                  onClick={() => send.mutate()}
                >
                  Enviar al proveedor
                </Button>
              </Can>
            )}
            {recibible && (
              <Can perm="purchasing:receipt:create">
                <Button
                  variant="primary"
                  icon={<PackageCheck className="size-4" />}
                  onClick={() => setReceiving(true)}
                >
                  Recibir mercancía
                </Button>
              </Can>
            )}
            {order.status !== 'CANCELLED' && order.status !== 'RECEIVED' && (
              <Can perm="purchasing:order:update">
                <Button variant="ghost" icon={<X className="size-4" />} onClick={() => setCancelling(true)}>
                  Cancelar
                </Button>
              </Can>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Badge tone={status?.tone ?? 'neutral'} dot>
          {status?.label ?? order.status}
        </Badge>
        <span className="text-fg-muted">Pedida el {date(order.orderDate)}</span>
        {order.expectedDate && (
          <>
            <span className="text-fg-subtle">·</span>
            <span className="text-fg-muted">Se espera el {date(order.expectedDate)}</span>
          </>
        )}
        <span className="ml-auto text-base font-semibold">
          {money(order.total, order.currencyCode)}
        </span>
      </div>

      {/* El contraste de tres vías: lo pedido, lo recibido y lo facturado. */}
      {problemas.length > 0 ? (
        <div
          role="status"
          className="rounded-[var(--radius-control)] bg-warning-soft p-3 text-sm text-warning-fg"
        >
          <p className="flex items-center gap-2 font-medium">
            <AlertTriangle className="size-4" aria-hidden="true" />
            Hay diferencias entre lo pedido y lo recibido
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-6">
            {problemas.flatMap((m) => m.issues).map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      ) : (
        order.status === 'RECEIVED' && (
          <p className="flex items-center gap-2 rounded-[var(--radius-control)] bg-success-soft p-3 text-sm text-success-fg">
            <CheckCircle2 className="size-4" aria-hidden="true" />
            Llegó exactamente lo que se pidió: no hay nada que revisar.
          </p>
        )
      )}

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[42rem] text-sm">
          <caption className="sr-only">Líneas de la orden</caption>
          <thead className="bg-surface-2 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Producto</th>
              <th className="px-3 py-2 text-right font-medium">Pedido</th>
              <th className="px-3 py-2 text-right font-medium">Recibido</th>
              <th className="px-3 py-2 text-right font-medium">Pendiente</th>
              <th className="px-3 py-2 text-right font-medium">Precio</th>
              <th className="px-3 py-2 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {lines.map((line) => (
              <tr key={line.id}>
                <td className="px-3 py-2">
                  <div className="font-medium">{line.description}</div>
                  {line.sku && <div className="font-mono text-xs text-fg-subtle">{line.sku}</div>}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{amount(line.quantity, 0)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{amount(line.received, 0)}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {Number(line.pending) > 0 ? (
                    <span className="font-medium text-warning-fg">{amount(line.pending, 0)}</span>
                  ) : (
                    <Badge tone="success">Completa</Badge>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {money(line.unitPrice, order.currencyCode)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {money(line.total, order.currencyCode)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-border bg-surface-2 font-semibold">
            <tr>
              <td className="px-3 py-2" colSpan={5}>
                Total
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {money(order.total, order.currencyCode)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {receipts.length > 0 && (
        <section className="card p-0">
          <h2 className="border-b border-border px-3 py-2 text-sm font-medium">Recepciones</h2>
          <ul className="divide-y divide-border text-sm">
            {receipts.map((receipt) => {
              const rs = RECEIPT_STATUS[receipt.status];
              return (
                <li key={receipt.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                  <Link
                    to={`/compras/recepciones/${receipt.id}`}
                    className="font-mono text-xs text-accent hover:underline"
                  >
                    {receipt.number ?? 'Borrador'}
                  </Link>
                  <span className="text-fg-muted">{date(receipt.receiptDate)}</span>
                  <Badge tone={rs?.tone ?? 'neutral'}>{rs?.label ?? receipt.status}</Badge>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <ReceiveDialog
        order={query.data}
        open={receiving}
        onOpenChange={setReceiving}
        onDone={() => {
          setReceiving(false);
          invalidate();
        }}
      />

      <Dialog open={cancelling} onOpenChange={setCancelling}>
        <DialogContent title="Cancelar la orden" description={order.number ?? ''}>
          <div className="grid gap-3">
            <Field label="Motivo" required>
              {(props) => (
                <Textarea
                  {...props}
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Por qué se cancela"
                />
              )}
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setCancelling(false)}>
                Volver
              </Button>
              <Button
                variant="danger"
                loading={cancel.isPending}
                disabled={!reason.trim()}
                onClick={() => cancel.mutate()}
              >
                Cancelar la orden
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, X } from 'lucide-react';
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
import { RECEIPT_STATUS } from '../lib/labels';
import type { ReceiptDetail } from '../lib/types';

export function ReceiptDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const query = useResource<ReceiptDetail>(`/purchasing/receipts/${id}`);
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState('');

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: [`/purchasing/receipts/${id}`] });
    void queryClient.invalidateQueries({ queryKey: ['/purchasing/receipts'] });
    void queryClient.invalidateQueries({ queryKey: ['/inventory/stock'] });
  };

  const postReceipt = useMutation({
    mutationFn: () => post(`/purchasing/receipts/${id}/post`),
    onSuccess: () => {
      toast.success('Recepción contabilizada: el inventario ya la refleja');
      invalidate();
    },
    onError: toast.error,
  });

  const voidReceipt = useMutation({
    mutationFn: () => post(`/purchasing/receipts/${id}/void`, { reason: reason.trim() }),
    onSuccess: () => {
      toast.success('Recepción anulada y mercancía devuelta');
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
        title="No se pudo cargar la recepción"
        description={(query.error as Error | null)?.message ?? 'No existe'}
        action={<Button onClick={() => navigate('/compras/recepciones')}>Volver</Button>}
      />
    );
  }

  const { receipt, lines } = query.data;
  const status = RECEIPT_STATUS[receipt.status];
  const total = lines.reduce((acc, l) => acc + Number(l.quantity) * Number(l.unitCost), 0);

  return (
    <>
      <PageHeader
        title={receipt.number ?? 'Borrador de recepción'}
        description={receipt.reference ? `Guía ${receipt.reference}` : 'Sin guía del proveedor'}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              icon={<ArrowLeft className="size-4" />}
              onClick={() => navigate('/compras/recepciones')}
            >
              Recepciones
            </Button>
            {receipt.status === 'DRAFT' && (
              <Can perm="purchasing:receipt:post">
                <Button
                  variant="primary"
                  icon={<Check className="size-4" />}
                  loading={postReceipt.isPending}
                  onClick={() => postReceipt.mutate()}
                >
                  Contabilizar
                </Button>
              </Can>
            )}
            {receipt.status !== 'VOID' && (
              <Can perm="purchasing:receipt:void">
                <Button variant="ghost" icon={<X className="size-4" />} onClick={() => setVoiding(true)}>
                  Anular
                </Button>
              </Can>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Badge tone={status?.tone ?? 'neutral'} dot>
          {status?.label ?? receipt.status}
        </Badge>
        <span className="text-fg-muted">{date(receipt.receiptDate)}</span>
        {receipt.orderId && (
          <Link
            to={`/compras/ordenes/${receipt.orderId}`}
            className="text-accent hover:underline"
          >
            Ver la orden
          </Link>
        )}
        <span className="ml-auto text-base font-semibold">{money(String(total))}</span>
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[34rem] text-sm">
          <caption className="sr-only">Mercancía recibida</caption>
          <thead className="bg-surface-2 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Producto</th>
              <th className="px-3 py-2 text-right font-medium">Cantidad</th>
              <th className="px-3 py-2 text-right font-medium">Costo unitario</th>
              <th className="px-3 py-2 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {lines.map((line) => (
              <tr key={line.id}>
                <td className="px-3 py-2">{line.description}</td>
                <td className="px-3 py-2 text-right tabular-nums">{amount(line.quantity, 0)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(line.unitCost)}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {money(String(Number(line.quantity) * Number(line.unitCost)))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-fg-subtle">
        El costo de esta recepción entra en el promedio ponderado de cada producto. Anularla genera
        movimientos de devolución, no borra los de entrada: el kardex tiene que poder contar lo que
        pasó.
      </p>

      <Dialog open={voiding} onOpenChange={setVoiding}>
        <DialogContent title="Anular la recepción" description={receipt.number ?? ''}>
          <div className="grid gap-3">
            <Field label="Motivo" required>
              {(props) => (
                <Textarea
                  {...props}
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Por ejemplo: mercancía averiada, devuelta al proveedor"
                />
              )}
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setVoiding(false)}>
                Volver
              </Button>
              <Button
                variant="danger"
                loading={voidReceipt.isPending}
                disabled={!reason.trim()}
                onClick={() => voidReceipt.mutate()}
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

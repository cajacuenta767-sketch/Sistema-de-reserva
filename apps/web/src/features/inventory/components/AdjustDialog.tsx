import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Dialog, DialogContent, Field, Input, Textarea } from '@/design-system';
import { post } from '@/lib/api/client';
import { useToast } from '@/store/toast';
import { amount } from '@/lib/format';
import type { StockRow } from '../lib/types';

interface Props {
  row: StockRow | null;
  onDone: () => void;
  onClose: () => void;
}

/**
 * Ajuste de existencias.
 *
 * Se pide la cantidad CONTADA, no la diferencia. Pedir la diferencia obliga a
 * hacer la resta mentalmente delante de la estantería, y una resta mal hecha
 * deja el inventario peor que antes sin que nada avise.
 */
export function AdjustDialog({ row, onDone, onClose }: Props) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [counted, setCounted] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const save = useMutation({
    mutationFn: () =>
      post('/inventory/stock/adjust', {
        productId: row?.product_id,
        warehouseId: row?.warehouse_id,
        counted: counted.replace(',', '.'),
        reason: reason.trim(),
      }),
    onSuccess: () => {
      toast.success('Existencias ajustadas');
      void queryClient.invalidateQueries({ queryKey: ['/inventory/stock'] });
      setCounted('');
      setReason('');
      onDone();
    },
    onError: toast.error,
  });

  const difference =
    row && counted.trim() ? Number(counted.replace(',', '.')) - Number(row.quantity) : null;

  return (
    <Dialog open={row !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title="Ajustar existencias"
        description={row ? `${row.product_name} · ${row.warehouse_name}` : ''}
      >
        <div className="grid gap-3">
          <p className="rounded-[var(--radius-control)] bg-surface-2 p-3 text-sm">
            El sistema dice <strong>{amount(row?.quantity ?? '0', 0)}</strong> unidades.
          </p>

          <Field
            label="Cantidad contada"
            required
            error={error || undefined}
            hint="Lo que hay de verdad en la estantería, no la diferencia."
          >
            {(props) => (
              <Input
                {...props}
                inputMode="decimal"
                value={counted}
                onChange={(e) => setCounted(e.target.value)}
                className="text-right tabular-nums"
              />
            )}
          </Field>

          {difference !== null && difference !== 0 && (
            <p className={difference < 0 ? 'text-sm text-danger-fg' : 'text-sm text-success-fg'}>
              {difference < 0 ? 'Faltan' : 'Sobran'} {amount(String(Math.abs(difference)), 0)}{' '}
              unidades.
            </p>
          )}

          <Field
            label="Motivo"
            required
            hint="Queda en el kardex y en la auditoría: es lo que explica por qué cambió el saldo."
          >
            {(props) => (
              <Textarea
                {...props}
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Por ejemplo: dos cajas averiadas en bodega"
              />
            )}
          </Field>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              loading={save.isPending}
              onClick={() => {
                if (!counted.trim()) return setError('Escribe la cantidad contada');
                if (!reason.trim()) return setError('Escribe el motivo del ajuste');
                setError('');
                save.mutate();
              }}
            >
              Ajustar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

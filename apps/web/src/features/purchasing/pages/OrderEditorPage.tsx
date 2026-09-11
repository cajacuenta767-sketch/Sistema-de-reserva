import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Save } from 'lucide-react';
import { Button, Field, Input, PageHeader, PageLoader, Select, Textarea } from '@/design-system';
import { post, put } from '@/lib/api/client';
import { useCollection, useResource } from '@/lib/api/useList';
import { useToast } from '@/store/toast';
import { LineEditor, emptyLine, type EditableLine } from '@/features/sales/components/LineEditor';
import { PartyPicker } from '@/features/sales/components/PartyPicker';
import type { Warehouse } from '@/features/inventory/lib/types';
import type { OrderDetail } from '../lib/types';

/**
 * Editor de órdenes de compra.
 *
 * Reutiliza el editor de líneas de ventas en modo compra: es el mismo gesto
 * —elegir producto, cantidad, precio— y una copia divergiría de la otra en el
 * primer arreglo.
 */
export function OrderEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const editing = Boolean(id);

  const existing = useResource<OrderDetail>(id ? `/purchasing/orders/${id}` : null);
  const warehouses = useCollection<Warehouse>('/inventory/warehouses/all');

  const [typed, setTyped] = useState<{
    partyId: string;
    partyName: string;
    warehouseId: string;
    expectedDate: string;
    notes: string;
    lines: EditableLine[];
  } | null>(null);

  // Estado derivado del servidor mientras nadie ha escrito nada: sin esto haría
  // falta un efecto que copie la respuesta al estado, y ese efecto pisa lo que
  // el usuario escribe cuando la consulta se revalida.
  const form =
    typed ??
    (existing.data
      ? {
          partyId: existing.data.order.partyId,
          partyName: existing.data.partyName,
          warehouseId: existing.data.order.warehouseId ?? '',
          expectedDate: existing.data.order.expectedDate ?? '',
          notes: existing.data.order.notes ?? '',
          lines: existing.data.lines.map((l) => ({
            key: l.id,
            productId: l.productId,
            description: l.description,
            sku: l.sku,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            discountPercent: l.discountPercent === '0' ? '' : l.discountPercent,
            taxId: null,
          })),
        }
      : {
          partyId: '',
          partyName: '',
          warehouseId: warehouses.data?.items.find((w) => w.isDefault)?.id ?? '',
          expectedDate: '',
          notes: '',
          lines: [emptyLine()],
        });

  const set = (patch: Partial<typeof form>) => setTyped({ ...form, ...patch });
  const [error, setError] = useState('');

  const save = useMutation({
    mutationFn: () => {
      const body = {
        partyId: form.partyId,
        ...(form.warehouseId ? { warehouseId: form.warehouseId } : {}),
        ...(form.expectedDate ? { expectedDate: form.expectedDate } : {}),
        ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
        lines: form.lines
          .filter((l) => l.description.trim() && Number(l.quantity.replace(',', '.')) > 0)
          .map((l) => ({
            ...(l.productId ? { productId: l.productId } : {}),
            description: l.description.trim(),
            quantity: l.quantity.replace(',', '.'),
            ...(l.unitPrice.trim() ? { unitPrice: l.unitPrice.replace(',', '.') } : {}),
            ...(l.discountPercent.trim()
              ? { discountPercent: l.discountPercent.replace(',', '.') }
              : {}),
          })),
      };
      return editing
        ? put<OrderDetail>(`/purchasing/orders/${id}`, body)
        : post<OrderDetail>('/purchasing/orders', body);
    },
    onSuccess: (result) => {
      toast.success(editing ? 'Orden actualizada' : 'Orden creada');
      void queryClient.invalidateQueries({ queryKey: ['/purchasing/orders'] });
      navigate(`/compras/ordenes/${result.order.id}`);
    },
    onError: toast.error,
  });

  if (editing && existing.isLoading) return <PageLoader />;

  return (
    <>
      <PageHeader
        title={editing ? 'Editar la orden' : 'Nueva orden de compra'}
        description="Lo que se le pide al proveedor. No mueve inventario hasta que llega."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              icon={<ArrowLeft className="size-4" />}
              onClick={() => navigate('/compras/ordenes')}
            >
              Cancelar
            </Button>
            <Button
              variant="primary"
              icon={<Save className="size-4" />}
              loading={save.isPending}
              onClick={() => {
                if (!form.partyId) return setError('Elige el proveedor');
                if (!form.lines.some((l) => l.description.trim())) {
                  return setError('Añade al menos una línea');
                }
                setError('');
                save.mutate();
              }}
            >
              Guardar
            </Button>
          </div>
        }
      />

      <div className="card grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Proveedor" required className="sm:col-span-2">
          {(props) => (
            <PartyPicker
              {...props}
              value={form.partyId}
              label={form.partyName}
              onPick={(party) => set({ partyId: party.id, partyName: party.display_name })}
            />
          )}
        </Field>
        <Field label="Bodega de destino" hint="Donde entrará la mercancía cuando llegue.">
          {(props) => (
            <Select
              {...props}
              value={form.warehouseId}
              onChange={(e) => set({ warehouseId: e.target.value })}
            >
              <option value="">La de por defecto</option>
              {(warehouses.data?.items ?? []).map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Fecha esperada" hint="Sirve para saber qué está con retraso.">
          {(props) => (
            <Input
              {...props}
              type="date"
              value={form.expectedDate}
              onChange={(e) => set({ expectedDate: e.target.value })}
            />
          )}
        </Field>
      </div>

      <LineEditor
        mode="PURCHASE"
        lines={form.lines}
        currency="COP"
        onChange={(lines) => set({ lines })}
      />

      <div className="card">
        <Field label="Notas">
          {(props) => (
            <Textarea
              {...props}
              rows={2}
              value={form.notes}
              onChange={(e) => set({ notes: e.target.value })}
            />
          )}
        </Field>
      </div>

      {error && (
        <p role="alert" className="rounded-[var(--radius-control)] bg-danger-soft p-3 text-sm text-danger-soft-fg">
          {error}
        </p>
      )}
    </>
  );
}

import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, X } from 'lucide-react';
import {
  Badge,
  Button,
  ErrorState,
  Input,
  PageHeader,
  PageLoader,
  StatTile,
} from '@/design-system';
import { patch, post } from '@/lib/api/client';
import { useResource } from '@/lib/api/useList';
import { Can } from '@/lib/authz/useCan';
import { useToast } from '@/store/toast';
import { amount, date, number } from '@/lib/format';
import { COUNT_STATUS } from '../lib/labels';
import type { CountDetail } from '../lib/types';

export function CountDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const query = useResource<CountDetail>(`/inventory/stock-counts/${id}`);

  /** Lo escrito y todavía no guardado, por línea. */
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: [`/inventory/stock-counts/${id}`] });
    void queryClient.invalidateQueries({ queryKey: ['/inventory/stock'] });
  };

  const setCounted = useMutation({
    mutationFn: (input: { lineId: string; counted: string | null }) =>
      patch(`/inventory/stock-counts/${id}/lines/${input.lineId}`, { counted: input.counted }),
    onSuccess: invalidate,
    onError: toast.error,
  });

  const apply = useMutation({
    mutationFn: () => post(`/inventory/stock-counts/${id}/apply`),
    onSuccess: () => {
      toast.success('Conteo aplicado: el inventario quedó en lo contado');
      invalidate();
    },
    onError: toast.error,
  });

  const cancel = useMutation({
    mutationFn: () => post(`/inventory/stock-counts/${id}/cancel`),
    onSuccess: () => {
      toast.success('Conteo cancelado');
      invalidate();
    },
    onError: toast.error,
  });

  if (query.isLoading) return <PageLoader />;
  if (query.error || !query.data) {
    return (
      <ErrorState
        title="No se pudo cargar el conteo"
        description={(query.error as Error | null)?.message ?? 'No existe'}
        action={<Button onClick={() => navigate('/inventario/conteos')}>Volver</Button>}
      />
    );
  }

  const { count, lines, summary } = query.data;
  const status = COUNT_STATUS[count.status];
  const editable = count.status === 'COUNTING';

  return (
    <>
      <PageHeader
        title={count.number ?? 'Conteo en curso'}
        description={`${count.warehouseName} · ${date(count.countDate)}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              icon={<ArrowLeft className="size-4" />}
              onClick={() => navigate('/inventario/conteos')}
            >
              Conteos
            </Button>
            {editable && (
              <>
                <Can perm="inventory:count:update">
                  <Button
                    variant="secondary"
                    icon={<X className="size-4" />}
                    loading={cancel.isPending}
                    onClick={() => cancel.mutate()}
                  >
                    Cancelar
                  </Button>
                </Can>
                <Can perm="inventory:count:apply">
                  <Button
                    variant="primary"
                    icon={<Check className="size-4" />}
                    loading={apply.isPending}
                    disabled={summary.counted === 0}
                    onClick={() => apply.mutate()}
                  >
                    Aplicar ajustes
                  </Button>
                </Can>
              </>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={status?.tone ?? 'neutral'} dot>
          {status?.label ?? count.status}
        </Badge>
        {count.appliedAt && (
          <span className="text-sm text-fg-muted">Aplicado el {date(count.appliedAt)}</span>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Productos" value={number(summary.lines)} />
        <StatTile
          label="Contados"
          value={`${number(summary.counted)} / ${number(summary.lines)}`}
          tone={summary.pending === 0 ? 'success' : 'accent'}
        />
        <StatTile
          label="Con diferencia"
          value={number(summary.withDifference)}
          tone={summary.withDifference > 0 ? 'warning' : 'success'}
        />
        <StatTile
          label="Diferencia neta"
          value={amount(summary.netDifference, 0)}
          hint="Unidades que sobran menos las que faltan"
        />
      </div>

      {editable && summary.pending > 0 && (
        <p className="rounded-[var(--radius-control)] bg-info-soft p-3 text-sm text-info-fg">
          Quedan {number(summary.pending)} productos sin contar. Al aplicar, esas líneas no se
          tocan: solo se ajusta lo que se contó.
        </p>
      )}

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[40rem] text-sm">
          <caption className="sr-only">Líneas del conteo</caption>
          <thead className="bg-surface-2 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Producto</th>
              <th className="px-3 py-2 text-right font-medium">Según el sistema</th>
              <th className="px-3 py-2 text-right font-medium">Contado</th>
              <th className="px-3 py-2 text-right font-medium">Diferencia</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {lines.map((line) => {
              const value = drafts[line.id] ?? line.counted ?? '';
              const difference = line.difference === null ? null : Number(line.difference);
              return (
                <tr key={line.id}>
                  <td className="px-3 py-2">
                    <div className="font-medium">{line.productName}</div>
                    {line.sku && <div className="font-mono text-xs text-fg-subtle">{line.sku}</div>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-fg-muted">
                    {amount(line.expected, 0)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {editable ? (
                      <Input
                        inputMode="decimal"
                        value={value}
                        aria-label={`Cantidad contada de ${line.productName}`}
                        className="ml-auto w-28 text-right tabular-nums"
                        onChange={(e) =>
                          setDrafts((current) => ({ ...current, [line.id]: e.target.value }))
                        }
                        onBlur={(e) => {
                          const raw = e.target.value.trim().replace(',', '.');
                          if (raw === (line.counted ?? '')) return;
                          setCounted.mutate({ lineId: line.id, counted: raw === '' ? null : raw });
                        }}
                      />
                    ) : (
                      <span className="tabular-nums">
                        {line.counted === null ? (
                          <span className="text-fg-subtle">Sin contar</span>
                        ) : (
                          amount(line.counted, 0)
                        )}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {difference === null ? (
                      <span className="text-fg-subtle">—</span>
                    ) : difference === 0 ? (
                      <Badge tone="success">Cuadra</Badge>
                    ) : (
                      <span className={difference < 0 ? 'text-danger-fg' : 'text-success-fg'}>
                        {difference > 0 ? '+' : ''}
                        {amount(line.difference, 0)}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-fg-subtle">
        La columna «según el sistema» se congeló al abrir el conteo. Las ventas hechas mientras se
        cuenta no la cambian: si lo hicieran, el ajuste taparía ese movimiento en vez de reflejar lo
        contado.
      </p>
    </>
  );
}

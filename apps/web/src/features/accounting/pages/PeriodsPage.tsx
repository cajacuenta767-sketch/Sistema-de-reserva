import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Lock, LockOpen, Plus } from 'lucide-react';
import {
  Badge,
  Button,
  Empty,
  ErrorState,
  PageHeader,
  PageLoader,
} from '@/design-system';
import { post } from '@/lib/api/client';
import { useResource } from '@/lib/api/useList';
import { Can, useCan } from '@/lib/authz/useCan';
import { useToast } from '@/store/toast';
import { dateShort } from '@/lib/format';
import { PERIOD_STATUS } from '../lib/labels';
import type { FiscalYear } from '../lib/types';

/**
 * Años fiscales y cierre de periodos.
 *
 * Es la pieza que da sentido a todo lo demás: cerrar enero significa que enero
 * ya no se mueve. Sin cierre, un balance presentado a la DIAN puede cambiar
 * mañana porque alguien corrigió una factura del año pasado, y nadie se entera.
 */
export function PeriodsPage() {
  const query = useResource<FiscalYear[]>('/accounting/fiscal-years');
  const queryClient = useQueryClient();
  const toast = useToast();
  const can = useCan();
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['/accounting/fiscal-years'] });

  const action = useMutation({
    mutationFn: (path: string) => post(path),
    onSuccess: () => {
      void refresh();
      setBusy(null);
    },
    onError: (err: Error) => {
      toast.error(err);
      setBusy(null);
    },
  });

  const run = (path: string, key: string, done: string) => {
    setBusy(key);
    action.mutate(path, { onSuccess: () => toast.success(done) });
  };

  const openYear = useMutation({
    mutationFn: (year: number) => post('/accounting/fiscal-years', { year }),
    onSuccess: () => {
      toast.success('Año fiscal abierto con sus doce meses y el periodo de ajustes');
      void refresh();
    },
    onError: toast.error,
  });

  if (query.isLoading) return <PageLoader />;
  if (query.error) {
    return (
      <ErrorState
        title="No se pudieron cargar los periodos"
        description={(query.error as Error).message}
        action={<Button onClick={() => void query.refetch()}>Reintentar</Button>}
      />
    );
  }

  const years = query.data ?? [];
  const nextYear = years.length === 0 ? new Date().getFullYear() : Number(years[0]?.year.name) + 1;

  return (
    <>
      <PageHeader
        title="Periodos contables"
        description="Lo cerrado ya no se mueve"
        actions={
          <Can perm="accounting:period:manage">
            <Button
              variant="primary"
              icon={<Plus className="size-4" />}
              loading={openYear.isPending}
              onClick={() => openYear.mutate(nextYear)}
            >
              Abrir {nextYear}
            </Button>
          </Can>
        }
      />

      {years.length === 0 && (
        <Empty
          icon={<CalendarDays className="size-6" />}
          title="Todavía no hay años fiscales"
          description="Se abre solo al contabilizar el primer documento, o puedes abrirlo ahora."
        />
      )}

      {years.map(({ year, periods }) => {
        const closed = periods.filter((p) => p.status === 'CLOSED').length;
        return (
          <section key={year.id} className="card p-0">
            <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
              <h2 className="text-base font-semibold">Año {year.name}</h2>
              <Badge tone={PERIOD_STATUS[year.status]?.tone ?? 'neutral'} dot>
                {PERIOD_STATUS[year.status]?.label ?? year.status}
              </Badge>
              <span className="text-sm text-fg-muted">
                {closed} de {periods.length} periodos cerrados
              </span>
              {year.status === 'OPEN' && closed === periods.length && (
                <Can perm="accounting:period:close">
                  <Button
                    size="sm"
                    variant="secondary"
                    className="ml-auto"
                    icon={<Lock className="size-4" />}
                    loading={busy === year.id}
                    onClick={() =>
                      run(
                        `/accounting/fiscal-years/${year.id}/close`,
                        year.id,
                        `Año ${year.name} cerrado`,
                      )
                    }
                  >
                    Cerrar el año
                  </Button>
                </Can>
              )}
              {year.status === 'CLOSED' && (
                <Can perm="accounting:period:reopen">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto"
                    icon={<LockOpen className="size-4" />}
                    loading={busy === year.id}
                    onClick={() =>
                      run(
                        `/accounting/fiscal-years/${year.id}/reopen`,
                        year.id,
                        `Año ${year.name} reabierto`,
                      )
                    }
                  >
                    Reabrir el año
                  </Button>
                </Can>
              )}
            </header>

            <ul className="divide-y divide-border">
              {periods.map((period) => {
                const status = PERIOD_STATUS[period.status];
                const canClose =
                  period.status === 'OPEN' &&
                  year.status === 'OPEN' &&
                  can('accounting:period:close');
                const canReopen =
                  period.status === 'CLOSED' &&
                  year.status === 'OPEN' &&
                  can('accounting:period:reopen');

                return (
                  <li key={period.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                    <span className="w-32 font-medium">{period.name}</span>
                    <span className="text-sm text-fg-muted">
                      {dateShort(period.startDate)} – {dateShort(period.endDate)}
                    </span>
                    <Badge tone={status?.tone ?? 'neutral'} dot>
                      {status?.label ?? period.status}
                    </Badge>
                    {period.periodNo === 13 && (
                      <span className="text-xs text-fg-subtle">
                        Para los ajustes del cierre, separados de diciembre
                      </span>
                    )}

                    <span className="ml-auto">
                      {canClose && (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<Lock className="size-4" />}
                          loading={busy === period.id}
                          onClick={() =>
                            run(
                              `/accounting/periods/${period.id}/close`,
                              period.id,
                              `${period.name} cerrado`,
                            )
                          }
                        >
                          Cerrar
                        </Button>
                      )}
                      {canReopen && (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<LockOpen className="size-4" />}
                          loading={busy === period.id}
                          onClick={() =>
                            run(
                              `/accounting/periods/${period.id}/reopen`,
                              period.id,
                              `${period.name} reabierto`,
                            )
                          }
                        >
                          Reabrir
                        </Button>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      {years.length > 0 && (
        <p className="text-xs text-fg-subtle">
          Los periodos se cierran en orden y se reabren en orden inverso: cerrar marzo dejando
          febrero abierto daría una falsa sensación de control, porque un asiento de febrero
          arrastra saldos a marzo.
        </p>
      )}
    </>
  );
}

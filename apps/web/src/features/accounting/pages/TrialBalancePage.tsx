import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Scale } from 'lucide-react';
import { Badge, Button, ErrorState, PageHeader, PageLoader, StatTile } from '@/design-system';
import { useResource } from '@/lib/api/useList';
import { amount } from '@/lib/format';
import { BalanceTree } from '../components/BalanceTree';
import { RangePicker } from '../components/RangePicker';
import { defaultRange } from '../lib/range';
import type { TrialBalance } from '../lib/types';

/**
 * Balance de prueba.
 *
 * El informe que da la señal de alarma: si las dos columnas no suman igual, hay
 * un problema en los datos y todo lo demás —el balance general, el estado de
 * resultados— está mal aunque parezca razonable. Por eso lo primero que se ve
 * es si cuadra, y no las cifras.
 */
export function TrialBalancePage() {
  const [range, setRange] = useState(defaultRange);
  const [includeZero, setIncludeZero] = useState(false);

  const query = useResource<TrialBalance>(
    `/accounting/reports/trial-balance?from=${range.from}&to=${range.to}` +
      (includeZero ? '&includeZero=true' : ''),
  );

  return (
    <>
      <PageHeader
        title="Balance de prueba"
        description="Débitos contra créditos, cuenta por cuenta"
        actions={
          <div className="flex flex-wrap items-end gap-4">
            <RangePicker from={range.from} to={range.to} onChange={setRange} />
            <label className="flex h-9 items-center gap-2 text-sm text-fg-muted">
              <input
                type="checkbox"
                checked={includeZero}
                onChange={(e) => setIncludeZero(e.target.checked)}
                className="size-4 accent-[var(--color-accent)]"
              />
              Incluir cuentas sin movimiento
            </label>
          </div>
        }
      />

      {query.isLoading && <PageLoader />}

      {query.error && (
        <ErrorState
          title="No se pudo calcular el balance"
          description={(query.error as Error).message}
          action={<Button onClick={() => void query.refetch()}>Reintentar</Button>}
        />
      )}

      {query.data && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatTile
              label="Total débitos"
              value={amount(query.data.totals.debit, 0)}
              icon={<Scale className="size-5" />}
            />
            <StatTile label="Total créditos" value={amount(query.data.totals.credit, 0)} />
            <StatTile
              label="Comprobación"
              value={query.data.totals.balanced ? 'Cuadra' : 'No cuadra'}
              hint={
                query.data.totals.balanced
                  ? 'Las dos columnas suman igual'
                  : 'Revisa los asientos del periodo antes de usar los demás informes'
              }
              icon={
                query.data.totals.balanced ? (
                  <CheckCircle2 className="size-5" />
                ) : (
                  <AlertTriangle className="size-5" />
                )
              }
              tone={query.data.totals.balanced ? 'success' : 'danger'}
            />
          </div>

          {!query.data.totals.balanced && (
            <div
              role="alert"
              className="rounded-[var(--radius-control)] bg-danger-soft p-4 text-sm text-danger-soft-fg"
            >
              <p className="font-medium">El balance no cuadra.</p>
              <p className="mt-1">
                La diferencia es de{' '}
                {amount(
                  String(Number(query.data.totals.debit) - Number(query.data.totals.credit)),
                  2,
                )}
                . Mientras no se corrija, el estado de resultados y el balance general muestran
                cifras que no son de fiar.
              </p>
            </div>
          )}

          <div className="card p-0">
            <BalanceTree nodes={query.data.rows} showOpening />
          </div>

          <p className="text-xs text-fg-subtle">
            Las cuentas de agrupación no se consultan: se calculan sumando sus hijas, así que su
            saldo no puede contradecir el detalle.{' '}
            <Badge tone="neutral">
              {query.data.from} a {query.data.to}
            </Badge>
          </p>
        </>
      )}
    </>
  );
}

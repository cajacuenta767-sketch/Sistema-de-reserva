import { useState } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Button, ErrorState, PageHeader, PageLoader, StatTile } from '@/design-system';
import { useResource } from '@/lib/api/useList';
import { amount } from '@/lib/format';
import { BalanceTree } from '../components/BalanceTree';
import { RangePicker } from '../components/RangePicker';
import { defaultRange } from '../lib/range';
import type { BalanceSheet } from '../lib/types';

/**
 * Balance general.
 *
 * El resultado del periodo se muestra APARTE del patrimonio porque hasta que no
 * se cierra el año no vive en ninguna cuenta. Sin sumarlo, el balance parecería
 * descuadrado exactamente por la utilidad del ejercicio, que es el descuadre
 * que más veces se reporta como error y nunca lo es.
 */
export function BalanceSheetPage() {
  const [range, setRange] = useState(defaultRange);
  const query = useResource<BalanceSheet>(`/accounting/reports/balance-sheet?to=${range.to}`);

  return (
    <>
      <PageHeader
        title="Balance general"
        description="Qué tiene la empresa, qué debe y qué queda"
        actions={<RangePicker from={range.from} to={range.to} onChange={setRange} onlyTo />}
      />

      {query.isLoading && <PageLoader />}
      {query.error && (
        <ErrorState
          title="No se pudo calcular el balance general"
          description={(query.error as Error).message}
          action={<Button onClick={() => void query.refetch()}>Reintentar</Button>}
        />
      )}

      {query.data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Activo" value={amount(query.data.totals.assets, 0)} tone="accent" />
            <StatTile label="Pasivo" value={amount(query.data.totals.liabilities, 0)} tone="warning" />
            <StatTile
              label="Patrimonio"
              value={amount(query.data.totals.equity, 0)}
              hint={`más ${amount(query.data.totals.result, 0)} de resultado del periodo`}
              tone="info"
            />
            <StatTile
              label="Ecuación contable"
              value={query.data.totals.balanced ? 'Cuadra' : 'No cuadra'}
              hint="Activo = pasivo + patrimonio + resultado"
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
            <p
              role="alert"
              className="rounded-[var(--radius-control)] bg-danger-soft p-4 text-sm text-danger-soft-fg"
            >
              La ecuación contable no se cumple: sobran {amount(query.data.totals.difference, 2)} en
              el activo. Revisa el balance de prueba antes de presentar este informe.
            </p>
          )}

          {/*
            * `min-w-0` en cada celda de la rejilla.
            *
            * Un elemento de rejilla mide por defecto `min-width: auto`, es decir
            * el ancho mínimo de su contenido. La tabla de saldos declara 40rem,
            * así que sin esto la celda se niega a bajar de 640 px y es la PÁGINA
            * la que se desborda, en vez de la tabla desplazarse dentro de su
            * contenedor. En un móvil eso deja la cabecera fuera de la pantalla.
            */}
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="card min-w-0 p-0">
              <h2 className="border-b border-border px-3 py-2 text-sm font-medium">Activo</h2>
              <BalanceTree nodes={query.data.assets} emptyLabel="Sin activos contabilizados" />
            </section>
            <div className="grid min-w-0 gap-4">
              <section className="card min-w-0 p-0">
                <h2 className="border-b border-border px-3 py-2 text-sm font-medium">Pasivo</h2>
                <BalanceTree nodes={query.data.liabilities} emptyLabel="Sin pasivos contabilizados" />
              </section>
              <section className="card min-w-0 p-0">
                <h2 className="border-b border-border px-3 py-2 text-sm font-medium">Patrimonio</h2>
                <BalanceTree nodes={query.data.equity} emptyLabel="Sin movimiento de patrimonio" />
              </section>
            </div>
          </div>
        </>
      )}
    </>
  );
}

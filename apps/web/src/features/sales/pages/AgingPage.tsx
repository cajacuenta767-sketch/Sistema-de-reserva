import { AlertTriangle } from 'lucide-react';
import { Button, Empty, ErrorState, PageHeader, PageLoader } from '@/design-system';
import { useCollection } from '@/lib/api/useList';
import { money } from '@/lib/format';
import { AGING_COLUMNS } from '../lib/labels';
import type { AgingRow } from '../lib/types';

/**
 * Cartera por edades.
 *
 * Es el informe con el que se decide a quién llamar. Los cortes de 30, 60 y 90
 * días son los que usa cualquier comité de cartera en Colombia: más allá de 90
 * la deuda se provisiona.
 */
export function AgingPage() {
  const query = useCollection<AgingRow>('/invoices/aging');

  if (query.isLoading) return <PageLoader />;
  if (query.error) {
    return (
      <ErrorState
        title="No se pudo cargar la cartera"
        description={(query.error as Error).message}
        action={<Button onClick={() => void query.refetch()}>Reintentar</Button>}
      />
    );
  }

  const rows = query.data?.items ?? [];
  const totals = AGING_COLUMNS.map((column) =>
    rows.reduce((acc, row) => acc + Number(row[column.key as keyof AgingRow] ?? 0), 0),
  );
  const grandTotal = rows.reduce((acc, row) => acc + Number(row.total), 0);

  return (
    <>
      <PageHeader
        title="Cartera por edades"
        description="Cuánto te debe cada cliente y desde cuándo"
      />

      {rows.length === 0 ? (
        <Empty
          icon={<AlertTriangle className="size-6" />}
          title="No hay cartera pendiente"
          description="Todas las facturas emitidas están cobradas."
        />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[44rem] text-sm">
            <caption className="sr-only">Saldos pendientes por cliente y antigüedad</caption>
            <thead className="bg-surface-2 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Cliente</th>
                {AGING_COLUMNS.map((column) => (
                  <th key={column.key} className="px-3 py-2 text-right font-medium">
                    {column.label}
                  </th>
                ))}
                <th className="px-3 py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <tr key={row.partyId}>
                  <td className="px-3 py-2 font-medium">{row.partyName}</td>
                  {AGING_COLUMNS.map((column) => {
                    const value = Number(row[column.key as keyof AgingRow] ?? 0);
                    return (
                      <td
                        key={column.key}
                        className={
                          value > 0 && column.key === 'd90_plus'
                            ? 'px-3 py-2 text-right tabular-nums font-medium text-danger-fg'
                            : 'px-3 py-2 text-right tabular-nums'
                        }
                      >
                        {value > 0 ? money(String(value)) : <span className="text-fg-subtle">—</span>}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">{money(row.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-border bg-surface-2">
              <tr className="font-semibold">
                <td className="px-3 py-2">Total</td>
                {totals.map((value, index) => (
                  <td key={AGING_COLUMNS[index]?.key} className="px-3 py-2 text-right tabular-nums">
                    {money(String(value))}
                  </td>
                ))}
                <td className="px-3 py-2 text-right tabular-nums">{money(String(grandTotal))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </>
  );
}

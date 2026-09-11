import { AlertTriangle } from 'lucide-react';
import { Button, Empty, ErrorState, PageHeader, PageLoader } from '@/design-system';
import { useCollection } from '@/lib/api/useList';
import { money } from '@/lib/format';
import { PAYABLE_COLUMNS } from '../lib/labels';
import type { PayableRow } from '../lib/types';

/**
 * Cuentas por pagar por edades.
 *
 * El espejo de la cartera: con quién hay que quedar bien y desde cuándo se le
 * debe. Los tramos son los mismos que usa cualquier tesorería en Colombia.
 */
export function PayablePage() {
  const query = useCollection<PayableRow>('/purchasing/bills/payable');

  if (query.isLoading) return <PageLoader />;
  if (query.error) {
    return (
      <ErrorState
        title="No se pudieron cargar las cuentas por pagar"
        description={(query.error as Error).message}
        action={<Button onClick={() => void query.refetch()}>Reintentar</Button>}
      />
    );
  }

  const rows = query.data?.items ?? [];
  const totals = PAYABLE_COLUMNS.map((column) =>
    rows.reduce((acc, row) => acc + Number(row[column.key as keyof PayableRow] ?? 0), 0),
  );
  const grandTotal = rows.reduce((acc, row) => acc + Number(row.total), 0);

  return (
    <>
      <PageHeader
        title="Cuentas por pagar"
        description="A quién le debes y desde cuándo"
      />

      {rows.length === 0 ? (
        <Empty
          icon={<AlertTriangle className="size-6" />}
          title="No debes nada"
          description="Todas las facturas de proveedor registradas están pagadas."
        />
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[44rem] text-sm">
            <caption className="sr-only">Saldos pendientes por proveedor y antigüedad</caption>
            <thead className="bg-surface-2 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Proveedor</th>
                {PAYABLE_COLUMNS.map((column) => (
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
                  {PAYABLE_COLUMNS.map((column) => {
                    const value = Number(row[column.key as keyof PayableRow] ?? 0);
                    return (
                      <td
                        key={column.key}
                        className={
                          value > 0 && column.key === 'd90_plus'
                            ? 'px-3 py-2 text-right font-medium tabular-nums text-danger-fg'
                            : 'px-3 py-2 text-right tabular-nums'
                        }
                      >
                        {value > 0 ? money(String(value)) : <span className="text-fg-subtle">—</span>}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">
                    {money(row.total)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-border bg-surface-2">
              <tr className="font-semibold">
                <td className="px-3 py-2">Total</td>
                {totals.map((value, index) => (
                  <td key={PAYABLE_COLUMNS[index]?.key} className="px-3 py-2 text-right tabular-nums">
                    {money(String(value))}
                  </td>
                ))}
                <td className="px-3 py-2 text-right tabular-nums">{money(String(grandTotal))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <p className="text-xs text-fg-subtle">
        Esta cifra tiene que coincidir con el saldo de la cuenta 2205 en la contabilidad. Si no
        cuadra, hay alguna factura sin contabilizar.
      </p>
    </>
  );
}

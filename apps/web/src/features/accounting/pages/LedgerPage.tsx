import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen } from 'lucide-react';
import { Button, Empty, ErrorState, PageHeader, PageLoader, Select, StatTile } from '@/design-system';
import { useResource } from '@/lib/api/useList';
import { amount, dateShort } from '@/lib/format';
import { RangePicker } from '../components/RangePicker';
import { defaultRange } from '../lib/range';
import { SOURCE_LABEL } from '../lib/labels';
import type { AccountNode, Ledger } from '../lib/types';

const postableOf = (nodes: readonly AccountNode[]): AccountNode[] =>
  nodes.flatMap((node) => [...(node.isPostable ? [node] : []), ...postableOf(node.children)]);

const SOURCE_PATHS: Record<string, string> = {
  sales_invoice: '/facturas',
  credit_note: '/notas-credito',
  payment: '/cobros',
};

/**
 * Libro mayor de una cuenta.
 *
 * El saldo corrido es lo que convierte una lista de movimientos en algo que se
 * puede cuadrar contra un extracto: se lee de arriba abajo y en cada línea dice
 * cuánto había en ese momento.
 */
export function LedgerPage() {
  const [range, setRange] = useState(defaultRange);
  const [accountId, setAccountId] = useState('');

  const accounts = useResource<AccountNode[]>('/accounting/accounts/tree');
  const postable = useMemo(() => postableOf(accounts.data ?? []), [accounts.data]);

  const query = useResource<Ledger>(
    accountId
      ? `/accounting/reports/ledger?accountId=${accountId}&from=${range.from}&to=${range.to}`
      : null,
  );

  const selected = postable.find((a) => a.id === accountId);

  return (
    <>
      <PageHeader
        title="Libro mayor"
        description="Movimiento y saldo de una cuenta, día a día"
        actions={
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-fg-muted">
              <span className="mb-1 block">Cuenta</span>
              <Select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="h-9 w-full sm:w-80"
              >
                <option value="">Elige una cuenta…</option>
                {postable.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.code} · {account.name}
                  </option>
                ))}
              </Select>
            </label>
            <RangePicker from={range.from} to={range.to} onChange={setRange} />
          </div>
        }
      />

      {!accountId && (
        <Empty
          icon={<BookOpen className="size-6" />}
          title="Elige una cuenta"
          description="El libro mayor se consulta cuenta por cuenta: es el detalle de lo que el balance de prueba resume."
        />
      )}

      {accountId && query.isLoading && <PageLoader />}
      {accountId && query.error && (
        <ErrorState
          title="No se pudo cargar el libro mayor"
          description={(query.error as Error).message}
          action={<Button onClick={() => void query.refetch()}>Reintentar</Button>}
        />
      )}

      {accountId && query.data && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatTile label="Saldo anterior" value={amount(query.data.opening, 0)} />
            <StatTile label="Movimientos" value={String(query.data.rows.length)} />
            <StatTile label="Saldo final" value={amount(query.data.closing, 0)} tone="accent" />
          </div>

          {query.data.truncated && (
            <p className="rounded-[var(--radius-control)] bg-warning-soft p-3 text-sm text-warning-fg">
              Esta cuenta tiene más movimientos de los que caben en pantalla. Acota el rango de
              fechas para verlos todos.
            </p>
          )}

          {query.data.rows.length === 0 ? (
            <Empty
              title="Sin movimiento en el rango"
              description={`${selected?.code} ${selected?.name} no se movió entre esas fechas.`}
            />
          ) : (
            <div className="card overflow-x-auto p-0">
              <table className="w-full min-w-[48rem] text-sm">
                <caption className="sr-only">
                  Movimientos de {selected?.code} {selected?.name}
                </caption>
                <thead className="bg-surface-2 text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">Fecha</th>
                    <th className="px-3 py-2 font-medium">Asiento</th>
                    <th className="px-3 py-2 font-medium">Concepto</th>
                    <th className="px-3 py-2 font-medium">Tercero</th>
                    <th className="px-3 py-2 text-right font-medium">Débito</th>
                    <th className="px-3 py-2 text-right font-medium">Crédito</th>
                    <th className="px-3 py-2 text-right font-medium">Saldo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {query.data.rows.map((row, index) => (
                    <tr key={`${row.entryId}-${index}`}>
                      <td className="px-3 py-2 whitespace-nowrap">{dateShort(row.entryDate)}</td>
                      <td className="px-3 py-2">
                        <Link
                          to={`/contabilidad/asientos/${row.entryId}`}
                          className="font-mono text-xs text-accent hover:underline"
                        >
                          {row.number}
                        </Link>
                        {row.sourceId && SOURCE_PATHS[row.sourceType] && (
                          <div className="text-xs">
                            <Link
                              to={`${SOURCE_PATHS[row.sourceType]}/${row.sourceId}`}
                              className="text-fg-muted hover:underline"
                            >
                              {SOURCE_LABEL[row.sourceType] ?? row.sourceType}
                            </Link>
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-fg-muted">{row.description}</td>
                      <td className="px-3 py-2">
                        {row.partyName ?? <span className="text-fg-subtle">—</span>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {Number(row.debit) > 0 ? amount(row.debit, 0) : <span className="text-fg-subtle">—</span>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {Number(row.credit) > 0 ? amount(row.credit, 0) : <span className="text-fg-subtle">—</span>}
                      </td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">
                        {amount(row.runningBalance, 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}

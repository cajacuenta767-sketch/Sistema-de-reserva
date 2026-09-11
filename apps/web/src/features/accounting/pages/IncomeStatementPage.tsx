import { useState } from 'react';
import { Button, ErrorState, PageHeader, PageLoader, StatTile } from '@/design-system';
import { TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import { useResource } from '@/lib/api/useList';
import { amount, percent } from '@/lib/format';
import { BalanceTree } from '../components/BalanceTree';
import { RangePicker } from '../components/RangePicker';
import { defaultRange } from '../lib/range';
import type { IncomeStatement } from '../lib/types';

/**
 * Estado de resultados.
 *
 * Las devoluciones en ventas restan solas porque su cuenta tiene naturaleza
 * débito dentro de una clase de crédito. Es la razón de que la naturaleza se
 * guarde por cuenta y no se deduzca de la clase.
 */
export function IncomeStatementPage() {
  const [range, setRange] = useState(defaultRange);
  const query = useResource<IncomeStatement>(
    `/accounting/reports/income-statement?from=${range.from}&to=${range.to}`,
  );

  const margin =
    query.data && Number(query.data.revenue) !== 0
      ? (Number(query.data.netResult) / Number(query.data.revenue)) * 100
      : null;

  return (
    <>
      <PageHeader
        title="Estado de resultados"
        description="Cuánto entró, cuánto costó y cuánto quedó"
        actions={<RangePicker from={range.from} to={range.to} onChange={setRange} />}
      />

      {query.isLoading && <PageLoader />}
      {query.error && (
        <ErrorState
          title="No se pudo calcular el estado de resultados"
          description={(query.error as Error).message}
          action={<Button onClick={() => void query.refetch()}>Reintentar</Button>}
        />
      )}

      {query.data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label="Ingresos"
              value={amount(query.data.revenue, 0)}
              hint="Netos de devoluciones"
              icon={<TrendingUp className="size-5" />}
              tone="success"
            />
            <StatTile
              label="Costo de ventas"
              value={amount(query.data.costs, 0)}
              icon={<TrendingDown className="size-5" />}
            />
            <StatTile
              label="Utilidad bruta"
              value={amount(query.data.grossProfit, 0)}
              hint="Ingresos menos costos, antes de gastos"
            />
            <StatTile
              label="Resultado del periodo"
              value={amount(query.data.netResult, 0)}
              hint={margin === null ? undefined : `Margen del ${percent(margin, 1)}`}
              icon={<Wallet className="size-5" />}
              tone={Number(query.data.netResult) >= 0 ? 'success' : 'danger'}
            />
          </div>

          <div className="card p-0">
            <BalanceTree
              nodes={query.data.rows}
              emptyLabel="No hay ingresos ni gastos contabilizados en este rango"
            />
          </div>

          <p className="text-xs text-fg-subtle">
            El resultado no vive todavía en ninguna cuenta de patrimonio: se traslada allí al cerrar
            el año.
          </p>
        </>
      )}
    </>
  );
}

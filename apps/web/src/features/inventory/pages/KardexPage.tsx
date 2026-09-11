import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen } from 'lucide-react';
import { Badge, Button, Empty, ErrorState, PageHeader, PageLoader, Select, StatTile } from '@/design-system';
import { useCollection, useList, useResource } from '@/lib/api/useList';
import { amount, dateShort, money } from '@/lib/format';
import { MOVE_KIND, MOVE_SOURCE } from '../lib/labels';
import type { KardexMove, StockRow, Warehouse } from '../lib/types';

/**
 * Kardex: el movimiento de un producto con su saldo en cada paso.
 *
 * Es el documento que contesta "¿por qué hay 37?" con los movimientos que lo
 * explican, en vez de con un número que hay que creerse.
 */
export function KardexPage() {
  const [productId, setProductId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');

  const warehouses = useCollection<Warehouse>('/inventory/warehouses/all');
  // Los productos salen del propio inventario: solo tiene sentido preguntar por
  // los que se mueven.
  const stock = useList<StockRow>(
    '/inventory/stock',
    new URLSearchParams({ pageSize: '200', sort: 'product_name' }),
  );

  const productos = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of stock.data?.items ?? []) seen.set(row.product_id, row.product_name);
    return [...seen].map(([id, name]) => ({ id, name }));
  }, [stock.data]);

  const query = useResource<{ items: KardexMove[] }>(
    productId
      ? `/inventory/stock/kardex?productId=${productId}` +
          (warehouseId ? `&warehouseId=${warehouseId}` : '')
      : null,
  );

  const moves = query.data?.items ?? [];
  const last = moves[moves.length - 1];

  return (
    <>
      <PageHeader
        title="Kardex"
        description="Todo lo que entró y salió de un producto, en orden"
        actions={
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-fg-muted">
              <span className="mb-1 block">Producto</span>
              <Select
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
                className="h-9 w-full sm:w-72"
              >
                <option value="">Elige un producto…</option>
                {productos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </label>
            <label className="text-xs text-fg-muted">
              <span className="mb-1 block">Bodega</span>
              <Select
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
                className="h-9 w-auto"
              >
                <option value="">Todas</option>
                {(warehouses.data?.items ?? []).map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </Select>
            </label>
          </div>
        }
      />

      {!productId && (
        <Empty
          icon={<BookOpen className="size-6" />}
          title="Elige un producto"
          description="El kardex se consulta producto por producto: es el detalle de lo que las existencias resumen."
        />
      )}

      {productId && query.isLoading && <PageLoader />}
      {productId && query.error && (
        <ErrorState
          title="No se pudo cargar el kardex"
          description={(query.error as Error).message}
          action={<Button onClick={() => void query.refetch()}>Reintentar</Button>}
        />
      )}

      {productId && query.data && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatTile label="Movimientos" value={String(moves.length)} />
            <StatTile label="Saldo actual" value={amount(last?.balanceAfter ?? '0', 0)} tone="accent" />
            <StatTile label="Costo promedio" value={money(last?.averageAfter ?? '0')} />
          </div>

          {moves.length === 0 ? (
            <Empty
              title="Sin movimiento"
              description="Este producto no se ha movido en el rango consultado."
            />
          ) : (
            <div className="card overflow-x-auto p-0">
              <table className="w-full min-w-[52rem] text-sm">
                <caption className="sr-only">Movimientos del producto</caption>
                <thead className="bg-surface-2 text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">Fecha</th>
                    <th className="px-3 py-2 font-medium">Movimiento</th>
                    <th className="px-3 py-2 font-medium">Origen</th>
                    <th className="px-3 py-2 text-right font-medium">Entrada</th>
                    <th className="px-3 py-2 text-right font-medium">Salida</th>
                    <th className="px-3 py-2 text-right font-medium">Costo unitario</th>
                    <th className="px-3 py-2 text-right font-medium">Saldo</th>
                    <th className="px-3 py-2 text-right font-medium">Promedio</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {moves.map((move) => {
                    const entra = !move.quantity.startsWith('-');
                    const kind = MOVE_KIND[move.kind];
                    const source = MOVE_SOURCE[move.sourceType];
                    return (
                      <tr key={move.id}>
                        <td className="px-3 py-2 whitespace-nowrap">{dateShort(move.moveDate)}</td>
                        <td className="px-3 py-2">
                          <Badge tone={kind?.tone ?? 'neutral'}>{kind?.label ?? move.kind}</Badge>
                          {move.notes && (
                            <div className="mt-0.5 text-xs text-fg-subtle">{move.notes}</div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {move.sourceId && source?.path ? (
                            <Link
                              to={`${source.path}/${move.sourceId}`}
                              className="text-accent hover:underline"
                            >
                              {source.label}
                            </Link>
                          ) : (
                            <span className="text-fg-subtle">{source?.label ?? '—'}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {entra ? amount(move.quantity, 0) : <span className="text-fg-subtle">—</span>}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {entra ? (
                            <span className="text-fg-subtle">—</span>
                          ) : (
                            amount(move.quantity.slice(1), 0)
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{money(move.unitCost)}</td>
                        <td className="px-3 py-2 text-right font-medium tabular-nums">
                          {amount(move.balanceAfter, 0)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-fg-muted">
                          {money(move.averageAfter)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-xs text-fg-subtle">
            El costo promedio solo cambia al ENTRAR mercancía: vender no altera lo que costó lo que
            queda.
          </p>
        </>
      )}
    </>
  );
}

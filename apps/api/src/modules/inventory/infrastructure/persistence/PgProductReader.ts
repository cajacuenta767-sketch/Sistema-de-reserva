import type { Tx } from '../../../../platform/db/unitOfWork.js';
import type { ProductForStock, ProductReader } from '../../application/use-cases/StockUseCases.js';

/**
 * Lectura directa de los productos que el inventario necesita.
 *
 * Consulta la tabla en vez de pasar por la API de `catalog` a propósito: lo que
 * hace falta son cinco columnas de una fila, y hacerlo por el caso de uso del
 * otro módulo traería precios, impuestos y variantes para tirarlos. La regla
 * que importa —no importar código de otro módulo— se respeta: aquí no se
 * importa nada de `catalog`.
 */
export class PgProductReader implements ProductReader {
  async forStock(tx: Tx, ids: readonly string[]): Promise<Map<string, ProductForStock>> {
    if (ids.length === 0) return new Map();
    const { rows } = await tx.client.query<{
      id: string;
      name: string;
      kind: string;
      sku: string | null;
      track_inventory: boolean;
      tracking: string;
      standard_cost: string;
    }>(
      `SELECT id, name, kind, sku, track_inventory, tracking, standard_cost::text AS standard_cost
         FROM products WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
      [[...ids]],
    );
    return new Map(
      rows.map((r) => [
        r.id,
        {
          id: r.id,
          name: r.name,
          kind: r.kind,
          sku: r.sku,
          trackInventory: r.track_inventory,
          tracking: r.tracking as ProductForStock['tracking'],
          standardCost: r.standard_cost,
        },
      ]),
    );
  }
}

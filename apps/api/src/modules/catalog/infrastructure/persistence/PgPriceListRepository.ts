import type { ListQuery } from '@erp/contracts';
import type { Tx } from '../../../../platform/db/unitOfWork.js';
import { runList, type ListResult, type ListSpec } from '../../../../platform/http/list.js';
import type { PriceListRef, PriceTier } from '../../domain/Pricing.js';
import type {
  PriceItemRecord,
  PriceItemRow,
  PriceListRecord,
  PriceListRepository,
} from '../../application/ports/CatalogRepositories.js';

interface PriceListDbRow {
  id: string;
  organization_id: string;
  name: string;
  kind: string;
  currency_code: string;
  mode: string;
  based_on_id: string | null;
  adjustment_percent: string;
  rounding: string;
  includes_tax: boolean;
  valid_from: string | null;
  valid_to: string | null;
  is_default: boolean;
  is_active: boolean;
}

const fromRow = (r: PriceListDbRow): PriceListRecord => ({
  id: r.id,
  organizationId: r.organization_id,
  name: r.name,
  kind: r.kind as 'SALE' | 'PURCHASE',
  currencyCode: r.currency_code,
  mode: r.mode as PriceListRef['mode'],
  basedOnId: r.based_on_id,
  adjustmentPercent: r.adjustment_percent,
  rounding: r.rounding,
  includesTax: r.includes_tax,
  validFrom: r.valid_from,
  validTo: r.valid_to,
  isDefault: r.is_default,
  isActive: r.is_active,
});

// Las fechas se leen con `::text` a propósito: `valid_from` es un `date` sin
// zona horaria, y dejar que el driver lo convierta a `Date` lo interpreta en la
// zona del servidor. Una lista válida "desde el 1 de marzo" se volvería válida
// desde el 28 de febrero a las 19:00 en Colombia, y las comparaciones de
// vigencia empezarían a fallar un día antes.
/**
 * Columnas de una lista de precios, con el alias de la tabla como prefijo.
 *
 * Es una función y no una constante porque la consulta recursiva de `chain`
 * necesita las mismas columnas con dos alias distintos. Antes se derivaba
 * partiendo la constante por comas y anteponiendo el prefijo, lo que funcionaba
 * solo mientras ninguna columna llevara una llamada a función: `trim_scale(x)::text
 * AS x` no tiene comas, pero cualquier `coalesce(a, b)` habría partido el SQL por
 * la mitad y el error habría salido como un 500 sin relación aparente.
 */
const columnsOf = (alias: string): string => `
  ${alias}.id, ${alias}.organization_id, ${alias}.name, ${alias}.kind, ${alias}.currency_code,
  ${alias}.mode, ${alias}.based_on_id,
  trim_scale(${alias}.adjustment_percent)::text AS adjustment_percent,
  trim_scale(${alias}.rounding)::text AS rounding, ${alias}.includes_tax,
  ${alias}.valid_from::text AS valid_from, ${alias}.valid_to::text AS valid_to,
  ${alias}.is_default, ${alias}.is_active`;

const COLUMNS = columnsOf('price_lists');

const itemsSpec = (priceListId: string): ListSpec => ({
  from: `FROM price_list_items i
         JOIN products p ON p.id = i.product_id
         LEFT JOIN product_variants v ON v.id = i.variant_id`,
  select: `i.id, i.product_id, i.variant_id, trim_scale(i.min_quantity)::text AS min_quantity,
           i.price::text AS price,
           coalesce(v.sku, p.sku) AS sku, coalesce(v.name, p.name) AS name`,
  fields: {
    sku: { column: 'coalesce(v.sku, p.sku)', type: 'text', sortable: true, filterable: true, searchable: true },
    name: { column: 'coalesce(v.name, p.name)', type: 'text', sortable: true, filterable: true, searchable: true },
    product_id: { column: 'i.product_id', type: 'uuid', sortable: false, filterable: true },
    min_quantity: { column: 'i.min_quantity', type: 'number', sortable: true, filterable: true },
    price: { column: 'i.price', type: 'number', sortable: true, filterable: true },
  },
  baseWhere: ['i.price_list_id = $1::uuid', 'p.deleted_at IS NULL'],
  baseParams: [priceListId],
  defaultSort: [
    { field: 'name', dir: 'asc' },
    { field: 'min_quantity', dir: 'asc' },
  ],
});

export class PgPriceListRepository implements PriceListRepository {
  async list(tx: Tx, organizationId: string, kind?: 'SALE' | 'PURCHASE'): Promise<PriceListRecord[]> {
    const { rows } = await tx.client.query<PriceListDbRow>(
      `SELECT ${COLUMNS} FROM price_lists
        WHERE organization_id = $1 AND ($2::text IS NULL OR kind = $2)
        ORDER BY is_default DESC, name`,
      [organizationId, kind ?? null],
    );
    return rows.map(fromRow);
  }

  async findById(tx: Tx, id: string): Promise<PriceListRecord | null> {
    const { rows } = await tx.client.query<PriceListDbRow>(
      `SELECT ${COLUMNS} FROM price_lists WHERE id = $1`,
      [id],
    );
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async findDefault(tx: Tx, organizationId: string, kind: 'SALE' | 'PURCHASE'): Promise<PriceListRecord | null> {
    const { rows } = await tx.client.query<PriceListDbRow>(
      `SELECT ${COLUMNS} FROM price_lists
        WHERE organization_id = $1 AND kind = $2 AND is_default AND is_active`,
      [organizationId, kind],
    );
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async save(tx: Tx, l: PriceListRecord): Promise<void> {
    await tx.client.query(
      `INSERT INTO price_lists (id, organization_id, name, kind, currency_code, mode, based_on_id,
         adjustment_percent, rounding, includes_tax, valid_from, valid_to, is_default, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::date,$12::date,$13,$14)`,
      [
        l.id, l.organizationId, l.name, l.kind, l.currencyCode, l.mode, l.basedOnId,
        l.adjustmentPercent, l.rounding, l.includesTax, l.validFrom, l.validTo, l.isDefault, l.isActive,
      ],
    );
  }

  async update(tx: Tx, l: PriceListRecord): Promise<void> {
    await tx.client.query(
      `UPDATE price_lists SET name = $2, kind = $3, currency_code = $4, mode = $5, based_on_id = $6,
         adjustment_percent = $7, rounding = $8, includes_tax = $9, valid_from = $10::date,
         valid_to = $11::date, is_default = $12, is_active = $13 WHERE id = $1`,
      [
        l.id, l.name, l.kind, l.currencyCode, l.mode, l.basedOnId, l.adjustmentPercent,
        l.rounding, l.includesTax, l.validFrom, l.validTo, l.isDefault, l.isActive,
      ],
    );
  }

  async delete(tx: Tx, id: string): Promise<void> {
    await tx.client.query('DELETE FROM price_lists WHERE id = $1', [id]);
  }

  async clearDefault(tx: Tx, organizationId: string, kind: 'SALE' | 'PURCHASE'): Promise<void> {
    await tx.client.query(
      'UPDATE price_lists SET is_default = false WHERE organization_id = $1 AND kind = $2 AND is_default',
      [organizationId, kind],
    );
  }

  /**
   * Cadena de listas desde la indicada hasta su raíz, en una sola consulta.
   *
   * Un bucle de `findById` haría una consulta por nivel, y esto se llama una vez
   * por línea de cada cotización, pedido y factura. El `CYCLE` de PostgreSQL
   * corta si alguien encadenara dos listas entre sí: sin él, la consulta no
   * terminaría nunca y el proceso se quedaría colgado.
   */
  async chain(tx: Tx, id: string): Promise<PriceListRef[]> {
    const { rows } = await tx.client.query<PriceListDbRow>(
      `WITH RECURSIVE ancestry AS (
         SELECT ${columnsOf('price_lists')}, 0 AS level FROM price_lists WHERE id = $1
         UNION ALL
         SELECT ${columnsOf('pl')}, a.level + 1
           FROM price_lists pl JOIN ancestry a ON pl.id = a.based_on_id
       ) CYCLE id SET is_cycle USING cycle_path
       SELECT * FROM ancestry WHERE NOT is_cycle ORDER BY level`,
      [id],
    );
    return rows.map(fromRow);
  }

  async tiersFor(
    tx: Tx,
    listIds: readonly string[],
    productId: string,
    variantId: string | null,
  ): Promise<PriceTier[]> {
    if (listIds.length === 0) return [];
    const { rows } = await tx.client.query<{ price_list_id: string; min_quantity: string; price: string }>(
      `SELECT price_list_id, trim_scale(min_quantity)::text AS min_quantity, price::text AS price
         FROM price_list_items
        WHERE price_list_id = ANY($1::uuid[]) AND product_id = $2
          AND (variant_id IS NOT DISTINCT FROM $3::uuid OR variant_id IS NULL)
        ORDER BY min_quantity`,
      [listIds, productId, variantId],
    );
    return rows.map((r) => ({ priceListId: r.price_list_id, minQuantity: r.min_quantity, price: r.price }));
  }

  async listItems(tx: Tx, query: ListQuery, priceListId: string): Promise<ListResult<PriceItemRow>> {
    return runList<PriceItemRow>(tx, itemsSpec(priceListId), query, {});
  }

  /**
   * Fija el precio de una escala, o lo corrige si ya existía.
   *
   * Devuelve el id REAL de la fila, no el que se propuso: en un conflicto gana
   * el de la fila que ya estaba, y devolver el otro daría al cliente un
   * identificador que no existe en la base.
   */
  async saveItem(tx: Tx, i: PriceItemRecord): Promise<string> {
    const { rows } = await tx.client.query<{ id: string }>(
      `INSERT INTO price_list_items (id, organization_id, price_list_id, product_id, variant_id,
         min_quantity, price)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (price_list_id, product_id, coalesce(variant_id, product_id), min_quantity)
       DO UPDATE SET price = EXCLUDED.price, updated_at = now()
       RETURNING id`,
      [i.id, i.organizationId, i.priceListId, i.productId, i.variantId, i.minQuantity, i.price],
    );
    return rows[0]?.id ?? i.id;
  }

  async findItem(tx: Tx, id: string): Promise<PriceItemRecord | null> {
    const { rows } = await tx.client.query<{
      id: string;
      organization_id: string;
      price_list_id: string;
      product_id: string;
      variant_id: string | null;
      min_quantity: string;
      price: string;
    }>(
      `SELECT id, organization_id, price_list_id, product_id, variant_id,
              trim_scale(min_quantity)::text AS min_quantity, price::text AS price
         FROM price_list_items WHERE id = $1`,
      [id],
    );
    const r = rows[0];
    return r
      ? {
          id: r.id,
          organizationId: r.organization_id,
          priceListId: r.price_list_id,
          productId: r.product_id,
          variantId: r.variant_id,
          minQuantity: r.min_quantity,
          price: r.price,
        }
      : null;
  }

  async deleteItem(tx: Tx, id: string): Promise<void> {
    await tx.client.query('DELETE FROM price_list_items WHERE id = $1', [id]);
  }

  async hasDerived(tx: Tx, id: string): Promise<boolean> {
    const { rows } = await tx.client.query<{ exists: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM price_lists WHERE based_on_id = $1) AS exists',
      [id],
    );
    return rows[0]?.exists ?? false;
  }
}

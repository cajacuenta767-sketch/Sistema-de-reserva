import { Decimal, newId } from '@erp/core';
import type { LocalDate } from '@erp/core';
import type { ListQuery } from '@erp/contracts';
import type { Tx } from '../../../../platform/db/unitOfWork.js';
import { runList, type ListResult, type ListSpec } from '../../../../platform/http/list.js';
import type { MoveKind } from '../../domain/StockMove.js';
import type { StockState } from '../../domain/Costing.js';
import type {
  CountLineRecord,
  CountRecord,
  CountRepository,
  LotRecord,
  LotRepository,
  MoveRepository,
  MoveRow,
  NewMove,
  WarehouseRecord,
  WarehouseRepository,
} from '../../application/ports/InventoryRepositories.js';

const WAREHOUSE_COLUMNS = `
  id, organization_id, code, name, branch_id, address, city, is_default, is_active`;

interface WarehouseDbRow {
  id: string;
  organization_id: string;
  code: string;
  name: string;
  branch_id: string | null;
  address: string | null;
  city: string | null;
  is_default: boolean;
  is_active: boolean;
}

const warehouseFrom = (r: WarehouseDbRow): WarehouseRecord => ({
  id: r.id,
  organizationId: r.organization_id,
  code: r.code,
  name: r.name,
  branchId: r.branch_id,
  address: r.address,
  city: r.city,
  isDefault: r.is_default,
  isActive: r.is_active,
});

export class PgWarehouseRepository implements WarehouseRepository {
  async list(tx: Tx, query: ListQuery): Promise<ListResult<Record<string, unknown>>> {
    const spec: ListSpec = {
      from: 'FROM warehouses w',
      select: `
        w.id, w.code, w.name, w.city, w.is_default, w.is_active,
        (SELECT coalesce(sum(l.quantity), 0)::text FROM stock_levels l WHERE l.warehouse_id = w.id)
          AS total_units,
        (SELECT coalesce(sum(l.quantity * l.average_cost), 0)::text FROM stock_levels l
          WHERE l.warehouse_id = w.id) AS total_value`,
      fields: {
        code: { column: 'w.code', type: 'text', sortable: true, filterable: true, searchable: true },
        name: { column: 'w.name', type: 'text', sortable: true, filterable: true, searchable: true },
        city: { column: 'w.city', type: 'text', sortable: true, filterable: true, searchable: true },
        is_active: { column: 'w.is_active', type: 'boolean', filterable: true },
        is_default: { column: 'w.is_default', type: 'boolean', filterable: true },
      },
      baseWhere: ['w.deleted_at IS NULL'],
      defaultSort: [{ field: 'code', dir: 'asc' }],
    };
    return runList(tx, spec, query);
  }

  async all(tx: Tx): Promise<WarehouseRecord[]> {
    const { rows } = await tx.client.query<WarehouseDbRow>(
      `SELECT ${WAREHOUSE_COLUMNS} FROM warehouses WHERE deleted_at IS NULL ORDER BY code`,
    );
    return rows.map(warehouseFrom);
  }

  async byId(tx: Tx, id: string): Promise<WarehouseRecord | null> {
    const { rows } = await tx.client.query<WarehouseDbRow>(
      `SELECT ${WAREHOUSE_COLUMNS} FROM warehouses WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return rows[0] ? warehouseFrom(rows[0]) : null;
  }

  async byCode(tx: Tx, code: string): Promise<WarehouseRecord | null> {
    const { rows } = await tx.client.query<WarehouseDbRow>(
      `SELECT ${WAREHOUSE_COLUMNS} FROM warehouses WHERE code = $1 AND deleted_at IS NULL`,
      [code],
    );
    return rows[0] ? warehouseFrom(rows[0]) : null;
  }

  async defaultOne(tx: Tx): Promise<WarehouseRecord | null> {
    const { rows } = await tx.client.query<WarehouseDbRow>(
      `SELECT ${WAREHOUSE_COLUMNS} FROM warehouses
        WHERE deleted_at IS NULL AND is_active
        ORDER BY is_default DESC, code
        LIMIT 1`,
    );
    return rows[0] ? warehouseFrom(rows[0]) : null;
  }

  async create(tx: Tx, w: WarehouseRecord): Promise<void> {
    await tx.client.query(
      `INSERT INTO warehouses
         (id, organization_id, code, name, branch_id, address, city, is_default, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [w.id, w.organizationId, w.code, w.name, w.branchId, w.address, w.city, w.isDefault, w.isActive],
    );
  }

  async update(tx: Tx, w: WarehouseRecord): Promise<void> {
    await tx.client.query(
      `UPDATE warehouses SET name = $2, branch_id = $3, address = $4, city = $5,
              is_default = $6, is_active = $7
        WHERE id = $1`,
      [w.id, w.name, w.branchId, w.address, w.city, w.isDefault, w.isActive],
    );
  }

  /**
   * Quita la marca de "por defecto" a las demás ANTES de ponerla.
   *
   * El índice único parcial impide que haya dos, así que sin este paso poner
   * una nueva fallaría con un error de clave duplicada que no dice nada útil.
   */
  async clearDefault(tx: Tx, exceptId: string): Promise<void> {
    await tx.client.query(
      'UPDATE warehouses SET is_default = false WHERE id <> $1 AND is_default',
      [exceptId],
    );
  }

  async softDelete(tx: Tx, id: string): Promise<void> {
    await tx.client.query('UPDATE warehouses SET deleted_at = now() WHERE id = $1', [id]);
  }

  async hasMovements(tx: Tx, id: string): Promise<boolean> {
    const { rows } = await tx.client.query<{ exists: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM stock_moves WHERE warehouse_id = $1) AS exists',
      [id],
    );
    return rows[0]?.exists ?? false;
  }
}

export class PgLotRepository implements LotRepository {
  async byId(tx: Tx, id: string): Promise<LotRecord | null> {
    const { rows } = await tx.client.query<{
      id: string;
      organization_id: string;
      product_id: string;
      code: string;
      expires_on: string | null;
      manufactured_on: string | null;
      created_at: Date;
    }>(
      `SELECT id, organization_id, product_id, code,
              expires_on::text AS expires_on, manufactured_on::text AS manufactured_on, created_at
         FROM stock_lots WHERE id = $1`,
      [id],
    );
    const r = rows[0];
    return r
      ? {
          id: r.id,
          organizationId: r.organization_id,
          productId: r.product_id,
          code: r.code,
          expiresOn: r.expires_on,
          manufacturedOn: r.manufactured_on,
          createdAt: r.created_at.toISOString(),
        }
      : null;
  }

  async ofProduct(tx: Tx, productId: string): Promise<LotRecord[]> {
    const { rows } = await tx.client.query<{
      id: string;
      organization_id: string;
      product_id: string;
      code: string;
      expires_on: string | null;
      manufactured_on: string | null;
      created_at: Date;
    }>(
      `SELECT id, organization_id, product_id, code,
              expires_on::text AS expires_on, manufactured_on::text AS manufactured_on, created_at
         FROM stock_lots WHERE product_id = $1 ORDER BY expires_on NULLS LAST, created_at`,
      [productId],
    );
    return rows.map((r) => ({
      id: r.id,
      organizationId: r.organization_id,
      productId: r.product_id,
      code: r.code,
      expiresOn: r.expires_on,
      manufacturedOn: r.manufactured_on,
      createdAt: r.created_at.toISOString(),
    }));
  }

  /** Crea el lote si no existe. Recibir el mismo lote dos veces es normal. */
  async ensure(tx: Tx, lot: LotRecord): Promise<LotRecord> {
    await tx.client.query(
      `INSERT INTO stock_lots (id, organization_id, product_id, code, expires_on, manufactured_on)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (organization_id, product_id, code) DO NOTHING`,
      [lot.id, lot.organizationId, lot.productId, lot.code, lot.expiresOn, lot.manufacturedOn],
    );
    const { rows } = await tx.client.query<{ id: string }>(
      'SELECT id FROM stock_lots WHERE organization_id = $1 AND product_id = $2 AND code = $3',
      [lot.organizationId, lot.productId, lot.code],
    );
    return { ...lot, id: rows[0]?.id ?? lot.id };
  }
}

const MOVE_SELECT = `
  m.id, m.move_date::text AS move_date, m.moved_at, m.kind,
  m.product_id, p.name AS product_name, p.sku,
  m.warehouse_id, w.name AS warehouse_name, lo.code AS lot_code,
  trim_scale(m.quantity)::text AS quantity, m.unit_cost::text AS unit_cost,
  m.total_cost::text AS total_cost, trim_scale(m.balance_after)::text AS balance_after,
  m.average_after::text AS average_after, m.source_type, m.source_id, m.notes`;

const MOVE_FROM = `
  FROM stock_moves m
  JOIN products p ON p.id = m.product_id
  JOIN warehouses w ON w.id = m.warehouse_id
  LEFT JOIN stock_lots lo ON lo.id = m.lot_id`;

interface MoveDbRow {
  id: string;
  move_date: string;
  moved_at: Date;
  kind: string;
  product_id: string;
  product_name: string;
  sku: string | null;
  warehouse_id: string;
  warehouse_name: string;
  lot_code: string | null;
  quantity: string;
  unit_cost: string;
  total_cost: string;
  balance_after: string;
  average_after: string;
  source_type: string;
  source_id: string | null;
  notes: string | null;
}

const moveFrom = (r: MoveDbRow): MoveRow => ({
  id: r.id,
  moveDate: r.move_date,
  movedAt: r.moved_at.toISOString(),
  kind: r.kind as MoveKind,
  productId: r.product_id,
  productName: r.product_name,
  sku: r.sku,
  warehouseId: r.warehouse_id,
  warehouseName: r.warehouse_name,
  lotCode: r.lot_code,
  quantity: r.quantity,
  unitCost: r.unit_cost,
  totalCost: r.total_cost,
  balanceAfter: r.balance_after,
  averageAfter: r.average_after,
  sourceType: r.source_type,
  sourceId: r.source_id,
  notes: r.notes,
});

export class PgMoveRepository implements MoveRepository {
  async list(tx: Tx, query: ListQuery): Promise<ListResult<Record<string, unknown>>> {
    const spec: ListSpec = {
      from: MOVE_FROM,
      select: MOVE_SELECT,
      fields: {
        move_date: { column: 'm.move_date', type: 'date', sortable: true, filterable: true },
        kind: { column: 'm.kind', type: 'text', sortable: true, filterable: true },
        product_id: { column: 'm.product_id', type: 'uuid', filterable: true },
        product_name: { column: 'p.name', type: 'text', sortable: true, filterable: true, searchable: true },
        sku: { column: 'p.sku', type: 'text', filterable: true, searchable: true },
        warehouse_id: { column: 'm.warehouse_id', type: 'uuid', filterable: true },
        source_type: { column: 'm.source_type', type: 'text', filterable: true },
        source_id: { column: 'm.source_id', type: 'uuid', filterable: true },
        quantity: { column: 'm.quantity', type: 'number', sortable: true, filterable: true },
      },
      // Por fecha e id: dos movimientos del mismo instante tienen un orden, y
      // sin desempate el kardex se reordena entre consultas y los saldos
      // acumulados dejan de cuadrar con lo que se ve.
      defaultSort: [
        { field: 'move_date', dir: 'desc' },
        { field: 'quantity', dir: 'desc' },
      ],
      aggregates: {
        in_units: 'COALESCE(SUM(m.quantity) FILTER (WHERE m.quantity > 0), 0)::text',
        out_units: 'COALESCE(SUM(-m.quantity) FILTER (WHERE m.quantity < 0), 0)::text',
      },
      countExpression: 'm.id',
    };
    return runList(tx, spec, query);
  }

  /**
   * Estado actual con la fila BLOQUEADA.
   *
   * El bloqueo es lo que hace correcto el promedio ponderado bajo concurrencia:
   * dos entradas simultáneas que leyeran el mismo promedio calcularían ambas el
   * suyo partiendo del saldo viejo, y la segunda pisaría a la primera dejando
   * un costo que no corresponde a ninguna de las dos compras.
   *
   * Se bloquea la fila de `stock_levels`, que existe siempre aunque esté en
   * cero: `INSERT … ON CONFLICT DO NOTHING` la crea antes de bloquearla, así
   * que dos primeras entradas simultáneas también se serializan.
   */
  async stateFor(tx: Tx, productId: string, warehouseId: string): Promise<StockState> {
    await tx.client.query(
      `INSERT INTO stock_levels (organization_id, product_id, warehouse_id)
       SELECT w.organization_id, $1, $2 FROM warehouses w WHERE w.id = $2
       ON CONFLICT (product_id, warehouse_id) DO NOTHING`,
      [productId, warehouseId],
    );
    const { rows } = await tx.client.query<{ quantity: string; average_cost: string }>(
      `SELECT quantity::text, average_cost::text
         FROM stock_levels WHERE product_id = $1 AND warehouse_id = $2
         FOR UPDATE`,
      [productId, warehouseId],
    );
    const r = rows[0];
    return {
      quantity: new Decimal(r?.quantity ?? 0),
      averageCost: new Decimal(r?.average_cost ?? 0),
    };
  }

  async insert(
    tx: Tx,
    organizationId: string,
    move: NewMove,
    createdBy: string | null,
  ): Promise<void> {
    await tx.client.query(
      `INSERT INTO stock_moves
         (id, organization_id, product_id, variant_id, warehouse_id, lot_id, kind, move_date,
          quantity, unit_cost, total_cost, balance_after, average_after,
          source_type, source_id, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::uuid)`,
      [
        move.id,
        organizationId,
        move.productId,
        move.variantId,
        move.warehouseId,
        move.lotId,
        move.kind,
        move.moveDate,
        move.quantity,
        move.unitCost,
        move.totalCost,
        move.balanceAfter,
        move.averageAfter,
        move.sourceType,
        move.sourceId,
        move.notes,
        createdBy,
      ],
    );
  }

  async kardex(
    tx: Tx,
    productId: string,
    warehouseId: string | null,
    from: LocalDate,
    to: LocalDate,
    limit: number,
  ): Promise<MoveRow[]> {
    const { rows } = await tx.client.query<MoveDbRow>(
      `SELECT ${MOVE_SELECT} ${MOVE_FROM}
        WHERE m.product_id = $1
          AND ($2::uuid IS NULL OR m.warehouse_id = $2::uuid)
          AND m.move_date BETWEEN $3::date AND $4::date
        ORDER BY m.moved_at, m.id
        LIMIT $5`,
      [productId, warehouseId, from, to, limit],
    );
    return rows.map(moveFrom);
  }

  async bySource(tx: Tx, sourceType: string, sourceId: string): Promise<MoveRow[]> {
    const { rows } = await tx.client.query<MoveDbRow>(
      `SELECT ${MOVE_SELECT} ${MOVE_FROM}
        WHERE m.source_type = $1 AND m.source_id = $2
        ORDER BY m.moved_at, m.id`,
      [sourceType, sourceId],
    );
    return rows.map(moveFrom);
  }

  /**
   * Recalcula el nivel DESDE los movimientos.
   *
   * No incrementa: suma. Es la diferencia entre una caché que se puede
   * reconstruir y un contador que, en cuanto se pierde un incremento, arrastra
   * el error para siempre sin que nada lo delate.
   */
  async refreshLevel(
    tx: Tx,
    organizationId: string,
    productId: string,
    warehouseId: string,
  ): Promise<void> {
    await tx.client.query(
      `INSERT INTO stock_levels (organization_id, product_id, warehouse_id, quantity, average_cost, updated_at)
       SELECT $1, $2, $3,
              COALESCE(SUM(m.quantity), 0),
              COALESCE(
                (SELECT average_after FROM stock_moves
                  WHERE product_id = $2 AND warehouse_id = $3
                  ORDER BY moved_at DESC, id DESC LIMIT 1), 0),
              now()
         FROM stock_moves m
        WHERE m.product_id = $2 AND m.warehouse_id = $3
       ON CONFLICT (product_id, warehouse_id) DO UPDATE
         SET quantity = EXCLUDED.quantity,
             average_cost = EXCLUDED.average_cost,
             updated_at = now()`,
      [organizationId, productId, warehouseId],
    );
  }

  async levels(tx: Tx, query: ListQuery): Promise<ListResult<Record<string, unknown>>> {
    const spec: ListSpec = {
      from: `
        FROM stock_levels l
        JOIN products p ON p.id = l.product_id
        JOIN warehouses w ON w.id = l.warehouse_id`,
      select: `
        l.product_id, p.name AS product_name, p.sku, p.min_stock::text AS min_stock,
        l.warehouse_id, w.name AS warehouse_name,
        trim_scale(l.quantity)::text AS quantity, trim_scale(l.reserved)::text AS reserved,
        trim_scale(l.quantity - l.reserved)::text AS available,
        l.average_cost::text AS average_cost,
        (l.quantity * l.average_cost)::text AS value,
        (p.min_stock IS NOT NULL AND l.quantity - l.reserved < p.min_stock) AS below_minimum`,
      fields: {
        product_name: { column: 'p.name', type: 'text', sortable: true, filterable: true, searchable: true },
        sku: { column: 'p.sku', type: 'text', sortable: true, filterable: true, searchable: true },
        warehouse_id: { column: 'l.warehouse_id', type: 'uuid', filterable: true },
        quantity: { column: 'l.quantity', type: 'number', sortable: true, filterable: true },
        available: { column: '(l.quantity - l.reserved)', type: 'number', sortable: true, filterable: true },
        value: { column: '(l.quantity * l.average_cost)', type: 'number', sortable: true, filterable: true },
        below_minimum: {
          column: '(p.min_stock IS NOT NULL AND l.quantity - l.reserved < p.min_stock)',
          type: 'boolean',
          filterable: true,
        },
      },
      baseWhere: ['p.deleted_at IS NULL', 'w.deleted_at IS NULL'],
      defaultSort: [{ field: 'product_name', dir: 'asc' }],
      aggregates: {
        total_units: 'COALESCE(SUM(l.quantity), 0)::text',
        total_value: 'COALESCE(SUM(l.quantity * l.average_cost), 0)::text',
        below_minimum_count:
          'COUNT(*) FILTER (WHERE p.min_stock IS NOT NULL AND l.quantity - l.reserved < p.min_stock)::int',
      },
      countExpression: '*',
    };
    return runList(tx, spec, query);
  }

  async levelOf(
    tx: Tx,
    productId: string,
    warehouseId: string,
  ): Promise<{ quantity: Decimal; reserved: Decimal }> {
    const { rows } = await tx.client.query<{ quantity: string; reserved: string }>(
      'SELECT quantity::text, reserved::text FROM stock_levels WHERE product_id = $1 AND warehouse_id = $2',
      [productId, warehouseId],
    );
    return {
      quantity: new Decimal(rows[0]?.quantity ?? 0),
      reserved: new Decimal(rows[0]?.reserved ?? 0),
    };
  }

  async totalValue(tx: Tx): Promise<string> {
    const { rows } = await tx.client.query<{ total: string }>(
      'SELECT COALESCE(SUM(quantity * average_cost), 0)::text AS total FROM stock_levels',
    );
    return rows[0]?.total ?? '0';
  }
}

export class PgCountRepository implements CountRepository {
  async list(tx: Tx, query: ListQuery): Promise<ListResult<Record<string, unknown>>> {
    const spec: ListSpec = {
      from: 'FROM stock_counts c JOIN warehouses w ON w.id = c.warehouse_id',
      select: `
        c.id, c.number, c.count_date::text AS count_date, c.status, c.notes,
        c.warehouse_id, w.name AS warehouse_name,
        (SELECT count(*) FROM stock_count_lines l WHERE l.count_id = c.id)::int AS line_count,
        (SELECT count(*) FROM stock_count_lines l
          WHERE l.count_id = c.id AND l.counted IS NOT NULL)::int AS counted_count`,
      fields: {
        number: { column: 'c.number', type: 'text', sortable: true, filterable: true, searchable: true },
        count_date: { column: 'c.count_date', type: 'date', sortable: true, filterable: true },
        status: { column: 'c.status', type: 'text', sortable: true, filterable: true },
        warehouse_id: { column: 'c.warehouse_id', type: 'uuid', filterable: true },
      },
      defaultSort: [{ field: 'count_date', dir: 'desc' }],
      countExpression: 'c.id',
    };
    return runList(tx, spec, query);
  }

  async byId(tx: Tx, id: string): Promise<CountRecord | null> {
    const { rows } = await tx.client.query<{
      id: string;
      organization_id: string;
      number: string | null;
      warehouse_id: string;
      warehouse_name: string;
      status: string;
      count_date: string;
      notes: string | null;
      applied_at: Date | null;
    }>(
      `SELECT c.id, c.organization_id, c.number, c.warehouse_id, w.name AS warehouse_name,
              c.status, c.count_date::text AS count_date, c.notes, c.applied_at
         FROM stock_counts c JOIN warehouses w ON w.id = c.warehouse_id
        WHERE c.id = $1`,
      [id],
    );
    const r = rows[0];
    return r
      ? {
          id: r.id,
          organizationId: r.organization_id,
          number: r.number,
          warehouseId: r.warehouse_id,
          warehouseName: r.warehouse_name,
          status: r.status as CountRecord['status'],
          countDate: r.count_date,
          notes: r.notes,
          appliedAt: r.applied_at ? r.applied_at.toISOString() : null,
        }
      : null;
  }

  async linesOf(tx: Tx, countId: string): Promise<CountLineRecord[]> {
    const { rows } = await tx.client.query<{
      id: string;
      count_id: string;
      product_id: string;
      product_name: string;
      sku: string | null;
      lot_id: string | null;
      expected: string;
      counted: string | null;
      difference: string | null;
      notes: string | null;
    }>(
      `SELECT l.id, l.count_id, l.product_id, p.name AS product_name, p.sku, l.lot_id,
              trim_scale(l.expected)::text AS expected,
              trim_scale(l.counted)::text AS counted,
              CASE WHEN l.counted IS NULL THEN NULL
                   ELSE trim_scale(l.counted - l.expected)::text END AS difference,
              l.notes
         FROM stock_count_lines l JOIN products p ON p.id = l.product_id
        WHERE l.count_id = $1
        ORDER BY p.name`,
      [countId],
    );
    return rows.map((r) => ({
      id: r.id,
      countId: r.count_id,
      productId: r.product_id,
      productName: r.product_name,
      sku: r.sku,
      lotId: r.lot_id,
      expected: r.expected,
      counted: r.counted,
      difference: r.difference,
      notes: r.notes,
    }));
  }

  async create(tx: Tx, count: CountRecord, createdBy: string | null): Promise<void> {
    await tx.client.query(
      `INSERT INTO stock_counts
         (id, organization_id, warehouse_id, status, count_date, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7::uuid)`,
      [
        count.id,
        count.organizationId,
        count.warehouseId,
        count.status,
        count.countDate,
        count.notes,
        createdBy,
      ],
    );
  }

  /**
   * Congela lo que dice el sistema al abrir el conteo.
   *
   * Si `expected` se leyera al APLICAR, una venta hecha mientras se cuenta
   * cambiaría la diferencia y el ajuste taparía ese movimiento en vez de
   * reflejar lo contado. El conteo mide un instante, y ese instante es cuando
   * se abre.
   */
  async seedLines(
    tx: Tx,
    organizationId: string,
    countId: string,
    warehouseId: string,
  ): Promise<number> {
    const { rowCount } = await tx.client.query(
      `INSERT INTO stock_count_lines (id, organization_id, count_id, product_id, expected)
       SELECT gen_random_uuid(), $1, $2, l.product_id, l.quantity
         FROM stock_levels l
         JOIN products p ON p.id = l.product_id
        WHERE l.warehouse_id = $3 AND p.deleted_at IS NULL AND p.track_inventory
       ON CONFLICT (count_id, product_id, lot_id) DO NOTHING`,
      [organizationId, countId, warehouseId],
    );
    return rowCount ?? 0;
  }

  async setCounted(tx: Tx, lineId: string, counted: string | null, notes: string | null): Promise<void> {
    await tx.client.query('UPDATE stock_count_lines SET counted = $2, notes = $3 WHERE id = $1', [
      lineId,
      counted,
      notes,
    ]);
  }

  async markApplied(tx: Tx, id: string, number: string, appliedBy: string | null): Promise<void> {
    await tx.client.query(
      `UPDATE stock_counts SET status = 'APPLIED', number = $2, applied_at = now(), applied_by = $3::uuid
        WHERE id = $1`,
      [id, number, appliedBy],
    );
  }

  async setStatus(tx: Tx, id: string, status: CountRecord['status']): Promise<void> {
    await tx.client.query('UPDATE stock_counts SET status = $2 WHERE id = $1', [id, status]);
  }
}

export const newLotId = (): string => newId();

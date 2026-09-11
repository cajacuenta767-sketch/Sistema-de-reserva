import { newId } from '@erp/core';
import type { Tx } from '../../../../platform/db/unitOfWork.js';
import type { Uom } from '../../domain/Uom.js';
import { DEFAULT_UOMS } from '../../domain/Uom.js';
import { COLOMBIAN_TAXES } from '../../domain/ColombianTaxes.js';
import type {
  CategoryNode,
  CategoryRepository,
  TaxRepository,
  TaxRow,
  UomRepository,
} from '../../application/ports/CatalogRepositories.js';

// ── Unidades de medida ───────────────────────────────────────────────────────

interface UomDbRow {
  id: string;
  organization_id: string;
  code: string;
  name: string;
  dimension: string;
  factor: string;
  precision: number;
  dian_code: string | null;
  is_base: boolean;
  is_active: boolean;
}

const uomFromRow = (r: UomDbRow): Uom => ({
  id: r.id,
  organizationId: r.organization_id,
  code: r.code,
  name: r.name,
  dimension: r.dimension as Uom['dimension'],
  factor: r.factor,
  precision: r.precision,
  dianCode: r.dian_code,
  isBase: r.is_base,
  isActive: r.is_active,
});

/**
 * `trim_scale` quita los ceros de relleno de un NUMERIC.
 *
 * `factor numeric(19,6)` se lee como "12.000000", y ese texto llega tal cual a
 * la pantalla: "Caja x 12.000000". Es una tasa o un factor, no un importe, así
 * que los decimales fijos no aportan nada. Los precios NO se tocan: ahí los
 * cuatro decimales son la precisión del dato, no adorno.
 */
const UOM_COLUMNS = `id, organization_id, code, name, dimension,
  trim_scale(factor)::text AS factor, precision, dian_code, is_base, is_active`;

export class PgUomRepository implements UomRepository {
  async list(tx: Tx, organizationId: string): Promise<Uom[]> {
    const { rows } = await tx.client.query<UomDbRow>(
      `SELECT ${UOM_COLUMNS} FROM uoms WHERE organization_id = $1
        ORDER BY dimension, factor`,
      [organizationId],
    );
    return rows.map(uomFromRow);
  }

  async findById(tx: Tx, id: string): Promise<Uom | null> {
    const { rows } = await tx.client.query<UomDbRow>(`SELECT ${UOM_COLUMNS} FROM uoms WHERE id = $1`, [id]);
    return rows[0] ? uomFromRow(rows[0]) : null;
  }

  async findByCode(tx: Tx, organizationId: string, code: string): Promise<Uom | null> {
    const { rows } = await tx.client.query<UomDbRow>(
      `SELECT ${UOM_COLUMNS} FROM uoms WHERE organization_id = $1 AND code = $2`,
      [organizationId, code],
    );
    return rows[0] ? uomFromRow(rows[0]) : null;
  }

  async save(tx: Tx, u: Uom): Promise<void> {
    await tx.client.query(
      `INSERT INTO uoms (id, organization_id, code, name, dimension, factor, precision, dian_code, is_base, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [u.id, u.organizationId, u.code, u.name, u.dimension, u.factor, u.precision, u.dianCode, u.isBase, u.isActive],
    );
  }

  async update(tx: Tx, u: Uom): Promise<void> {
    await tx.client.query(
      `UPDATE uoms SET code = $2, name = $3, dimension = $4, factor = $5, precision = $6,
         dian_code = $7, is_base = $8, is_active = $9 WHERE id = $1`,
      [u.id, u.code, u.name, u.dimension, u.factor, u.precision, u.dianCode, u.isBase, u.isActive],
    );
  }

  async delete(tx: Tx, id: string): Promise<void> {
    await tx.client.query('DELETE FROM uoms WHERE id = $1', [id]);
  }

  async isInUse(tx: Tx, id: string): Promise<boolean> {
    const { rows } = await tx.client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM products
          WHERE (uom_id = $1 OR sale_uom_id = $1 OR purchase_uom_id = $1) AND deleted_at IS NULL
         UNION ALL
         SELECT 1 FROM product_components WHERE uom_id = $1
       ) AS exists`,
      [id],
    );
    return rows[0]?.exists ?? false;
  }

  /** Siembra las unidades por defecto. Idempotente: no duplica al repetirse. */
  async seed(tx: Tx, organizationId: string): Promise<number> {
    let created = 0;
    for (const seed of DEFAULT_UOMS) {
      const { rowCount } = await tx.client.query(
        `INSERT INTO uoms (id, organization_id, code, name, dimension, factor, precision, dian_code, is_base)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (organization_id, code) DO NOTHING`,
        [
          newId(), organizationId, seed.code, seed.name, seed.dimension,
          seed.factor, seed.precision, seed.dianCode, seed.isBase,
        ],
      );
      created += rowCount ?? 0;
    }
    return created;
  }
}

// ── Categorías ───────────────────────────────────────────────────────────────

interface CategoryDbRow {
  id: string;
  parent_id: string | null;
  name: string;
  path: string;
  depth: number;
  description: string | null;
  is_active: boolean;
  product_count: number;
}

const categoryFromRow = (r: CategoryDbRow): CategoryNode => ({
  id: r.id,
  parentId: r.parent_id,
  name: r.name,
  path: r.path,
  depth: r.depth,
  description: r.description,
  isActive: r.is_active,
  productCount: r.product_count,
});

/**
 * El conteo de productos es el de la categoría Y toda su descendencia.
 *
 * Contar solo los hijos directos haría que una rama con 500 productos repartidos
 * en subcategorías mostrara 0, y el árbol parecería vacío justo donde está todo.
 * `path LIKE` aprovecha la ruta materializada: sin ella haría falta un CTE
 * recursivo por cada nodo.
 */
const CATEGORY_SELECT = `c.id, c.parent_id, c.name, c.path, c.depth, c.description, c.is_active,
  (SELECT count(*)::int FROM products p
    JOIN product_categories pc ON pc.id = p.category_id
   WHERE p.deleted_at IS NULL
     AND (pc.id = c.id OR pc.path LIKE c.path || ' / %')) AS product_count`;

export class PgCategoryRepository implements CategoryRepository {
  async tree(tx: Tx, organizationId: string): Promise<CategoryNode[]> {
    const { rows } = await tx.client.query<CategoryDbRow>(
      `SELECT ${CATEGORY_SELECT} FROM product_categories c
        WHERE c.organization_id = $1 ORDER BY c.path`,
      [organizationId],
    );
    return rows.map(categoryFromRow);
  }

  async findById(tx: Tx, id: string): Promise<CategoryNode | null> {
    const { rows } = await tx.client.query<CategoryDbRow>(
      `SELECT ${CATEGORY_SELECT} FROM product_categories c WHERE c.id = $1`,
      [id],
    );
    return rows[0] ? categoryFromRow(rows[0]) : null;
  }

  async findByPath(tx: Tx, organizationId: string, path: string): Promise<CategoryNode | null> {
    const { rows } = await tx.client.query<CategoryDbRow>(
      `SELECT ${CATEGORY_SELECT} FROM product_categories c
        WHERE c.organization_id = $1 AND c.path = $2`,
      [organizationId, path],
    );
    return rows[0] ? categoryFromRow(rows[0]) : null;
  }

  async save(tx: Tx, organizationId: string, n: Omit<CategoryNode, 'productCount'>): Promise<void> {
    await tx.client.query(
      `INSERT INTO product_categories (id, organization_id, parent_id, name, path, depth, description, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [n.id, organizationId, n.parentId, n.name, n.path, n.depth, n.description, n.isActive],
    );
  }

  async update(tx: Tx, _organizationId: string, n: Omit<CategoryNode, 'productCount'>): Promise<void> {
    await tx.client.query(
      `UPDATE product_categories SET parent_id = $2, name = $3, path = $4, depth = $5,
         description = $6, is_active = $7 WHERE id = $1`,
      [n.id, n.parentId, n.name, n.path, n.depth, n.description, n.isActive],
    );
  }

  /**
   * Reescribe las rutas de la descendencia tras mover o renombrar una rama.
   *
   * Una sola sentencia para toda la rama, no una por nodo: mover "Bebidas" con
   * 200 subcategorías haría 200 viajes a la base, y a mitad de camino el árbol
   * quedaría con rutas de dos épocas distintas si algo fallara.
   */
  async rewriteSubtree(tx: Tx, organizationId: string, oldPath: string, newPath: string): Promise<void> {
    await tx.client.query(
      `UPDATE product_categories
          SET path = $3 || substring(path from length($2) + 1),
              depth = depth + ($4::int)
        WHERE organization_id = $1 AND path LIKE $2 || ' / %'`,
      [organizationId, oldPath, newPath, depthDelta(oldPath, newPath)],
    );
  }

  async delete(tx: Tx, id: string): Promise<void> {
    await tx.client.query('DELETE FROM product_categories WHERE id = $1', [id]);
  }

  async hasChildren(tx: Tx, id: string): Promise<boolean> {
    const { rows } = await tx.client.query<{ exists: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM product_categories WHERE parent_id = $1) AS exists',
      [id],
    );
    return rows[0]?.exists ?? false;
  }

  async hasProducts(tx: Tx, id: string): Promise<boolean> {
    const { rows } = await tx.client.query<{ exists: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM products WHERE category_id = $1 AND deleted_at IS NULL) AS exists',
      [id],
    );
    return rows[0]?.exists ?? false;
  }
}

/** Cuántos niveles sube o baja una rama al moverse. */
const segments = (path: string): number => path.split(' / ').length;
const depthDelta = (oldPath: string, newPath: string): number => segments(newPath) - segments(oldPath);

// ── Impuestos ────────────────────────────────────────────────────────────────

const TAX_COLUMNS = `id, code, name, kind, trim_scale(rate)::text AS rate, is_withholding, applies_to,
  trim_scale(min_base)::text AS min_base, dian_tax_code, is_active`;

export class PgTaxRepository implements TaxRepository {
  async list(tx: Tx, organizationId: string): Promise<TaxRow[]> {
    const { rows } = await tx.client.query<TaxRow>(
      `SELECT ${TAX_COLUMNS} FROM taxes WHERE organization_id = $1
        ORDER BY is_withholding, kind, rate DESC`,
      [organizationId],
    );
    return rows;
  }

  async findById(tx: Tx, id: string): Promise<TaxRow | null> {
    const { rows } = await tx.client.query<TaxRow>(`SELECT ${TAX_COLUMNS} FROM taxes WHERE id = $1`, [id]);
    return rows[0] ?? null;
  }

  async findByCode(tx: Tx, organizationId: string, code: string): Promise<TaxRow | null> {
    const { rows } = await tx.client.query<TaxRow>(
      `SELECT ${TAX_COLUMNS} FROM taxes WHERE organization_id = $1 AND code = $2`,
      [organizationId, code],
    );
    return rows[0] ?? null;
  }

  async save(tx: Tx, organizationId: string, t: TaxRow): Promise<void> {
    await tx.client.query(
      `INSERT INTO taxes (id, organization_id, code, name, kind, rate, is_withholding, applies_to,
         min_base, dian_tax_code, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        t.id, organizationId, t.code, t.name, t.kind, t.rate, t.is_withholding,
        t.applies_to, t.min_base, t.dian_tax_code, t.is_active,
      ],
    );
  }

  async update(tx: Tx, _organizationId: string, t: TaxRow): Promise<void> {
    await tx.client.query(
      `UPDATE taxes SET code = $2, name = $3, kind = $4, rate = $5, is_withholding = $6,
         applies_to = $7, min_base = $8, dian_tax_code = $9, is_active = $10 WHERE id = $1`,
      [t.id, t.code, t.name, t.kind, t.rate, t.is_withholding, t.applies_to, t.min_base, t.dian_tax_code, t.is_active],
    );
  }

  async delete(tx: Tx, id: string): Promise<void> {
    await tx.client.query('DELETE FROM taxes WHERE id = $1', [id]);
  }

  async isInUse(tx: Tx, id: string): Promise<boolean> {
    const { rows } = await tx.client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM products
          WHERE (sale_tax_id = $1 OR purchase_tax_id = $1) AND deleted_at IS NULL
       ) AS exists`,
      [id],
    );
    return rows[0]?.exists ?? false;
  }

  async seed(tx: Tx, organizationId: string): Promise<number> {
    let created = 0;
    for (const seed of COLOMBIAN_TAXES) {
      const { rowCount } = await tx.client.query(
        `INSERT INTO taxes (id, organization_id, code, name, kind, rate, is_withholding,
           applies_to, min_base, dian_tax_code)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (organization_id, code) DO NOTHING`,
        [
          newId(), organizationId, seed.code, seed.name, seed.kind, seed.rate,
          seed.isWithholding, seed.appliesTo, seed.minBase, seed.dianTaxCode,
        ],
      );
      created += rowCount ?? 0;
    }
    return created;
  }
}

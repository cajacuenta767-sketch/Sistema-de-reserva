import type { ListQuery } from '@erp/contracts';
import type { Tx } from '../../../../platform/db/unitOfWork.js';
import type { ScopeFilter } from '../../../../platform/authz/scope.js';
import { runList, type ListResult, type ListSpec } from '../../../../platform/http/list.js';
import type { Product, ProductVariant } from '../../domain/Product.js';
import type {
  ProductForDocument,
  ProductOverview,
  ProductRepository,
  ProductRow,
  VariantRepository,
} from '../../application/ports/CatalogRepositories.js';

interface ProductDbRow {
  id: string;
  organization_id: string;
  sku: string;
  barcode: string | null;
  name: string;
  description: string | null;
  kind: string;
  category_id: string | null;
  uom_id: string;
  sale_uom_id: string | null;
  purchase_uom_id: string | null;
  sale_price: string;
  purchase_price: string;
  currency_code: string;
  price_includes_tax: boolean;
  sale_tax_id: string | null;
  purchase_tax_id: string | null;
  track_inventory: boolean;
  cost_method: string;
  standard_cost: string;
  min_stock: string | null;
  max_stock: string | null;
  tracking: string;
  income_account_id: string | null;
  expense_account_id: string | null;
  inventory_account_id: string | null;
  brand: string | null;
  manufacturer_sku: string | null;
  weight_kg: string | null;
  is_sellable: boolean;
  is_purchasable: boolean;
  is_active: boolean;
  owner_membership_id: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

const fromRow = (r: ProductDbRow): Product => ({
  id: r.id,
  organizationId: r.organization_id,
  sku: r.sku,
  barcode: r.barcode,
  name: r.name,
  description: r.description,
  kind: r.kind as Product['kind'],
  categoryId: r.category_id,
  uomId: r.uom_id,
  saleUomId: r.sale_uom_id,
  purchaseUomId: r.purchase_uom_id,
  salePrice: r.sale_price,
  purchasePrice: r.purchase_price,
  currencyCode: r.currency_code,
  priceIncludesTax: r.price_includes_tax,
  saleTaxId: r.sale_tax_id,
  purchaseTaxId: r.purchase_tax_id,
  trackInventory: r.track_inventory,
  costMethod: r.cost_method as Product['costMethod'],
  standardCost: r.standard_cost,
  minStock: r.min_stock,
  maxStock: r.max_stock,
  tracking: r.tracking as Product['tracking'],
  incomeAccountId: r.income_account_id,
  expenseAccountId: r.expense_account_id,
  inventoryAccountId: r.inventory_account_id,
  brand: r.brand,
  manufacturerSku: r.manufacturer_sku,
  weightKg: r.weight_kg,
  isSellable: r.is_sellable,
  isPurchasable: r.is_purchasable,
  isActive: r.is_active,
  ownerMembershipId: r.owner_membership_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  deletedAt: r.deleted_at,
});

const COLUMNS = `id, organization_id, sku, barcode, name, description, kind, category_id, uom_id,
  sale_uom_id, purchase_uom_id, sale_price, purchase_price, currency_code, price_includes_tax,
  sale_tax_id, purchase_tax_id, track_inventory, cost_method, standard_cost, min_stock, max_stock,
  tracking, income_account_id, expense_account_id, inventory_account_id, brand, manufacturer_sku,
  weight_kg, is_sellable, is_purchasable, is_active, owner_membership_id, created_at, updated_at, deleted_at`;

/**
 * Listado de productos.
 *
 * La categoría, la unidad y el impuesto se traen con JOIN porque son relaciones
 * uno-a-uno y no multiplican filas. El número de variantes va en subconsulta,
 * que sí lo haría: un producto con cinco variantes contaría cinco veces y el
 * total de la paginación mentiría.
 */
const listSpec = (): ListSpec => ({
  from: `FROM products p
         LEFT JOIN product_categories c ON c.id = p.category_id
         JOIN uoms um ON um.id = p.uom_id
         LEFT JOIN taxes t ON t.id = p.sale_tax_id`,
  select: `p.id, p.sku, p.barcode, p.name, p.kind, p.sale_price, p.purchase_price, p.currency_code,
           p.track_inventory, p.is_active, p.created_at,
           c.path AS category_path, um.code AS uom_code,
           t.code AS sale_tax_code, trim_scale(t.rate)::text AS sale_tax_rate,
           (SELECT count(*)::int FROM product_variants v
             WHERE v.product_id = p.id AND v.deleted_at IS NULL) AS variant_count`,
  fields: {
    sku: { column: 'p.sku', type: 'text', sortable: true, filterable: true, searchable: true },
    barcode: { column: 'p.barcode', type: 'text', sortable: false, filterable: true, searchable: true },
    name: { column: 'p.name', type: 'text', sortable: true, filterable: true, searchable: true },
    description: { column: 'p.description', type: 'text', sortable: false, filterable: false, searchable: true },
    brand: { column: 'p.brand', type: 'text', sortable: true, filterable: true, searchable: true },
    kind: { column: 'p.kind', type: 'text', sortable: true, filterable: true },
    category_id: { column: 'p.category_id', type: 'uuid', sortable: false, filterable: true },
    // Filtrar por ruta incluye la rama entera: `filter[category_path][like]=Bebidas`
    // trae también las gaseosas, que es lo que alguien espera al pulsar una rama.
    category_path: { column: 'c.path', type: 'text', sortable: true, filterable: true, searchable: true },
    uom_id: { column: 'p.uom_id', type: 'uuid', sortable: false, filterable: true },
    sale_tax_id: { column: 'p.sale_tax_id', type: 'uuid', sortable: false, filterable: true },
    sale_price: { column: 'p.sale_price', type: 'number', sortable: true, filterable: true },
    purchase_price: { column: 'p.purchase_price', type: 'number', sortable: true, filterable: true },
    track_inventory: { column: 'p.track_inventory', type: 'boolean', sortable: false, filterable: true },
    tracking: { column: 'p.tracking', type: 'text', sortable: false, filterable: true },
    is_sellable: { column: 'p.is_sellable', type: 'boolean', sortable: false, filterable: true },
    is_purchasable: { column: 'p.is_purchasable', type: 'boolean', sortable: false, filterable: true },
    is_active: { column: 'p.is_active', type: 'boolean', sortable: true, filterable: true },
    created_at: { column: 'p.created_at', type: 'timestamp', sortable: true, filterable: true },
  },
  baseWhere: ['p.deleted_at IS NULL'],
  defaultSort: [{ field: 'name', dir: 'asc' }],
  ownerColumn: 'p.owner_membership_id',
  aggregates: {
    active: 'count(*) FILTER (WHERE p.is_active)::int',
    goods: `count(*) FILTER (WHERE p.kind = 'GOOD')::int`,
    services: `count(*) FILTER (WHERE p.kind = 'SERVICE')::int`,
    // Valor del catálogo a precio de venta: el dato que se pide al abrir la lista.
    total_sale_value: 'coalesce(sum(p.sale_price), 0)::text',
  },
});

export class PgProductRepository implements ProductRepository {
  async findById(tx: Tx, id: string): Promise<Product | null> {
    const { rows } = await tx.client.query<ProductDbRow>(
      `SELECT ${COLUMNS} FROM products WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async findBySku(tx: Tx, organizationId: string, sku: string): Promise<Product | null> {
    const { rows } = await tx.client.query<ProductDbRow>(
      `SELECT ${COLUMNS} FROM products
        WHERE organization_id = $1 AND sku = $2 AND deleted_at IS NULL`,
      [organizationId, sku],
    );
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async findByBarcode(tx: Tx, organizationId: string, barcode: string): Promise<Product | null> {
    const { rows } = await tx.client.query<ProductDbRow>(
      `SELECT ${COLUMNS} FROM products
        WHERE organization_id = $1 AND barcode = $2 AND deleted_at IS NULL`,
      [organizationId, barcode],
    );
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async list(tx: Tx, query: ListQuery, scope: ScopeFilter): Promise<ListResult<ProductRow>> {
    return runList<ProductRow>(tx, listSpec(), query, scope);
  }

  async save(tx: Tx, p: Product): Promise<void> {
    await tx.client.query(
      `INSERT INTO products (id, organization_id, sku, barcode, name, description, kind, category_id,
         uom_id, sale_uom_id, purchase_uom_id, sale_price, purchase_price, currency_code,
         price_includes_tax, sale_tax_id, purchase_tax_id, track_inventory, cost_method, standard_cost,
         min_stock, max_stock, tracking, income_account_id, expense_account_id, inventory_account_id,
         brand, manufacturer_sku, weight_kg, is_sellable, is_purchasable, is_active,
         owner_membership_id, created_by, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
               $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$35)`,
      [
        p.id, p.organizationId, p.sku, p.barcode, p.name, p.description, p.kind, p.categoryId,
        p.uomId, p.saleUomId, p.purchaseUomId, p.salePrice, p.purchasePrice, p.currencyCode,
        p.priceIncludesTax, p.saleTaxId, p.purchaseTaxId, p.trackInventory, p.costMethod, p.standardCost,
        p.minStock, p.maxStock, p.tracking, p.incomeAccountId, p.expenseAccountId, p.inventoryAccountId,
        p.brand, p.manufacturerSku, p.weightKg, p.isSellable, p.isPurchasable, p.isActive,
        p.ownerMembershipId, p.ownerMembershipId, p.createdAt,
      ],
    );
  }

  async update(tx: Tx, p: Product): Promise<void> {
    await tx.client.query(
      `UPDATE products SET sku = $2, barcode = $3, name = $4, description = $5, kind = $6,
         category_id = $7, uom_id = $8, sale_uom_id = $9, purchase_uom_id = $10, sale_price = $11,
         purchase_price = $12, currency_code = $13, price_includes_tax = $14, sale_tax_id = $15,
         purchase_tax_id = $16, track_inventory = $17, cost_method = $18, standard_cost = $19,
         min_stock = $20, max_stock = $21, tracking = $22, income_account_id = $23,
         expense_account_id = $24, inventory_account_id = $25, brand = $26, manufacturer_sku = $27,
         weight_kg = $28, is_sellable = $29, is_purchasable = $30, is_active = $31,
         owner_membership_id = $32
       WHERE id = $1`,
      [
        p.id, p.sku, p.barcode, p.name, p.description, p.kind, p.categoryId, p.uomId, p.saleUomId,
        p.purchaseUomId, p.salePrice, p.purchasePrice, p.currencyCode, p.priceIncludesTax, p.saleTaxId,
        p.purchaseTaxId, p.trackInventory, p.costMethod, p.standardCost, p.minStock, p.maxStock,
        p.tracking, p.incomeAccountId, p.expenseAccountId, p.inventoryAccountId, p.brand,
        p.manufacturerSku, p.weightKg, p.isSellable, p.isPurchasable, p.isActive, p.ownerMembershipId,
      ],
    );
  }

  async softDelete(tx: Tx, id: string, at: Date): Promise<void> {
    await tx.client.query('UPDATE products SET deleted_at = $2 WHERE id = $1', [id, at]);
  }

  async nextSequence(tx: Tx, organizationId: string): Promise<number> {
    const { rows } = await tx.client.query<{ total: string }>(
      'SELECT count(*)::text AS total FROM products WHERE organization_id = $1',
      [organizationId],
    );
    return Number(rows[0]?.total ?? 0) + 1;
  }

  async search(
    tx: Tx,
    organizationId: string,
    term: string,
    limit: number,
  ): Promise<Array<{ id: string; sku: string; name: string; sale_price: string }>> {
    const { rows } = await tx.client.query<{ id: string; sku: string; name: string; sale_price: string }>(
      `SELECT id, sku, name, sale_price::text AS sale_price FROM products
        WHERE organization_id = $1 AND deleted_at IS NULL
          AND (name ILIKE $2 OR sku ILIKE $2 OR barcode = $3)
        ORDER BY name LIMIT $4`,
      [organizationId, `%${term}%`, term, limit],
    );
    return rows;
  }

  /** Una sola consulta para todos los productos de un documento. */
  async forDocument(
    tx: Tx,
    organizationId: string,
    ids: readonly string[],
  ): Promise<ProductForDocument[]> {
    if (ids.length === 0) return [];
    const { rows } = await tx.client.query<Record<string, string | boolean | null>>(
      `SELECT p.id, p.sku, p.name, p.sale_price::text AS sale_price,
              p.purchase_price::text AS purchase_price, p.currency_code, p.price_includes_tax,
              um.code AS uom_code,
              st.id AS sale_tax_id, st.code AS sale_tax_code, st.kind AS sale_tax_kind,
              trim_scale(st.rate)::text AS sale_tax_rate,
              pt.id AS purchase_tax_id, pt.code AS purchase_tax_code, pt.kind AS purchase_tax_kind,
              trim_scale(pt.rate)::text AS purchase_tax_rate
         FROM products p
         JOIN uoms um ON um.id = p.uom_id
         LEFT JOIN taxes st ON st.id = p.sale_tax_id
         LEFT JOIN taxes pt ON pt.id = p.purchase_tax_id
        WHERE p.organization_id = $1 AND p.id = ANY($2::uuid[]) AND p.deleted_at IS NULL`,
      [organizationId, ids],
    );

    return rows.map((r) => ({
      id: String(r.id),
      sku: String(r.sku),
      name: String(r.name),
      uomCode: String(r.uom_code),
      salePrice: String(r.sale_price),
      purchasePrice: String(r.purchase_price),
      currencyCode: String(r.currency_code),
      priceIncludesTax: Boolean(r.price_includes_tax),
      saleTax: r.sale_tax_id
        ? {
            id: String(r.sale_tax_id),
            code: String(r.sale_tax_code),
            kind: String(r.sale_tax_kind),
            rate: String(r.sale_tax_rate),
          }
        : null,
      purchaseTax: r.purchase_tax_id
        ? {
            id: String(r.purchase_tax_id),
            code: String(r.purchase_tax_code),
            kind: String(r.purchase_tax_kind),
            rate: String(r.purchase_tax_rate),
          }
        : null,
    }));
  }

  async overview(tx: Tx, organizationId: string, scope: ScopeFilter): Promise<ProductOverview> {
    // El alcance se empuja aquí igual que en el listado: si no, los contadores
    // mostrarían totales de productos que el usuario no puede abrir.
    const conditions = ['organization_id = $1', 'deleted_at IS NULL'];
    const params: unknown[] = [organizationId];

    if (scope.ownerMembershipId) {
      params.push(scope.ownerMembershipId);
      conditions.push(`owner_membership_id = $${params.length}::uuid`);
    } else if (scope.ownerMembershipIdIn) {
      params.push(scope.ownerMembershipIdIn);
      conditions.push(`owner_membership_id = ANY($${params.length}::uuid[])`);
    }

    const { rows } = await tx.client.query<{
      total: string;
      goods: string;
      services: string;
      kits: string;
      inactive: string;
      without_price: string;
      below_cost: string;
    }>(
      `SELECT count(*)::text AS total,
              count(*) FILTER (WHERE kind = 'GOOD')::text AS goods,
              count(*) FILTER (WHERE kind = 'SERVICE')::text AS services,
              count(*) FILTER (WHERE kind = 'KIT')::text AS kits,
              count(*) FILTER (WHERE NOT is_active)::text AS inactive,
              count(*) FILTER (WHERE is_sellable AND sale_price = 0)::text AS without_price,
              count(*) FILTER (WHERE is_sellable AND purchase_price > 0
                                 AND sale_price > 0 AND sale_price < purchase_price)::text AS below_cost
         FROM products WHERE ${conditions.join(' AND ')}`,
      params,
    );

    const r = rows[0];
    return {
      total: Number(r?.total ?? 0),
      goods: Number(r?.goods ?? 0),
      services: Number(r?.services ?? 0),
      kits: Number(r?.kits ?? 0),
      inactive: Number(r?.inactive ?? 0),
      withoutPrice: Number(r?.without_price ?? 0),
      belowCost: Number(r?.below_cost ?? 0),
    };
  }
}

interface VariantDbRow {
  id: string;
  organization_id: string;
  product_id: string;
  sku: string;
  barcode: string | null;
  name: string;
  attributes: Record<string, string>;
  price_delta: string;
  weight_kg: string | null;
  is_active: boolean;
}

const variantFromRow = (r: VariantDbRow): ProductVariant => ({
  id: r.id,
  organizationId: r.organization_id,
  productId: r.product_id,
  sku: r.sku,
  barcode: r.barcode,
  name: r.name,
  attributes: r.attributes,
  priceDelta: r.price_delta,
  weightKg: r.weight_kg,
  isActive: r.is_active,
});

const VARIANT_COLUMNS = `id, organization_id, product_id, sku, barcode, name, attributes,
  price_delta, weight_kg, is_active`;

export class PgVariantRepository implements VariantRepository {
  async listByProduct(tx: Tx, productId: string): Promise<ProductVariant[]> {
    const { rows } = await tx.client.query<VariantDbRow>(
      `SELECT ${VARIANT_COLUMNS} FROM product_variants
        WHERE product_id = $1 AND deleted_at IS NULL ORDER BY name`,
      [productId],
    );
    return rows.map(variantFromRow);
  }

  async findById(tx: Tx, id: string): Promise<ProductVariant | null> {
    const { rows } = await tx.client.query<VariantDbRow>(
      `SELECT ${VARIANT_COLUMNS} FROM product_variants WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return rows[0] ? variantFromRow(rows[0]) : null;
  }

  async findBySku(tx: Tx, organizationId: string, sku: string): Promise<ProductVariant | null> {
    const { rows } = await tx.client.query<VariantDbRow>(
      `SELECT ${VARIANT_COLUMNS} FROM product_variants
        WHERE organization_id = $1 AND sku = $2 AND deleted_at IS NULL`,
      [organizationId, sku],
    );
    return rows[0] ? variantFromRow(rows[0]) : null;
  }

  async save(tx: Tx, v: ProductVariant): Promise<void> {
    await tx.client.query(
      `INSERT INTO product_variants (id, organization_id, product_id, sku, barcode, name,
         attributes, price_delta, weight_kg, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)`,
      [
        v.id, v.organizationId, v.productId, v.sku, v.barcode, v.name,
        JSON.stringify(v.attributes), v.priceDelta, v.weightKg, v.isActive,
      ],
    );
  }

  async update(tx: Tx, v: ProductVariant): Promise<void> {
    await tx.client.query(
      `UPDATE product_variants SET sku = $2, barcode = $3, name = $4, attributes = $5::jsonb,
         price_delta = $6, weight_kg = $7, is_active = $8 WHERE id = $1`,
      [v.id, v.sku, v.barcode, v.name, JSON.stringify(v.attributes), v.priceDelta, v.weightKg, v.isActive],
    );
  }

  async softDelete(tx: Tx, id: string, at: Date): Promise<void> {
    await tx.client.query('UPDATE product_variants SET deleted_at = $2 WHERE id = $1', [id, at]);
  }
}

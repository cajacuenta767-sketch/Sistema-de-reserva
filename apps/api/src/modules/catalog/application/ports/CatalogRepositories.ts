import type { ListQuery } from '@erp/contracts';
import type { Tx } from '../../../../platform/db/unitOfWork.js';
import type { ScopeFilter } from '../../../../platform/authz/scope.js';

/** Lo que el selector de líneas necesita: los dos precios, para vender y comprar. */
export interface ProductSearchHit {
  id: string;
  sku: string;
  name: string;
  sale_price: string;
  purchase_price: string;
}
import type { ListResult } from '../../../../platform/http/list.js';
import type { Product, ProductVariant } from '../../domain/Product.js';
import type { Uom } from '../../domain/Uom.js';
import type { PriceListRef, PriceTier } from '../../domain/Pricing.js';

/** Fila del listado de productos: lo que la tabla muestra sin abrir la ficha. */
export interface ProductRow extends Record<string, unknown> {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  kind: string;
  category_path: string | null;
  uom_code: string;
  sale_price: string;
  purchase_price: string;
  currency_code: string;
  sale_tax_code: string | null;
  sale_tax_rate: string | null;
  track_inventory: boolean;
  is_active: boolean;
  variant_count: number;
  created_at: Date;
}

export interface ProductRepository {
  findById(tx: Tx, id: string): Promise<Product | null>;
  findBySku(tx: Tx, organizationId: string, sku: string): Promise<Product | null>;
  findByBarcode(tx: Tx, organizationId: string, barcode: string): Promise<Product | null>;
  list(tx: Tx, query: ListQuery, scope: ScopeFilter): Promise<ListResult<ProductRow>>;
  save(tx: Tx, product: Product): Promise<void>;
  update(tx: Tx, product: Product): Promise<void>;
  softDelete(tx: Tx, id: string, at: Date): Promise<void>;
  /** Siguiente número para generar un SKU automático. */
  nextSequence(tx: Tx, organizationId: string): Promise<number>;
  search(
    tx: Tx,
    organizationId: string,
    term: string,
    limit: number,
  ): Promise<ProductSearchHit[]>;
  overview(tx: Tx, organizationId: string, scope: ScopeFilter): Promise<ProductOverview>;
  /** Datos de varios productos para las líneas de un documento, en una consulta. */
  forDocument(tx: Tx, organizationId: string, ids: readonly string[]): Promise<ProductForDocument[]>;
}

/**
 * Lo que una línea de documento necesita de un producto, resuelto en UNA
 * consulta para todos los productos del documento.
 *
 * Pedirlo producto a producto haría cinco consultas por línea: una factura de
 * veinte líneas son cien viajes a la base para pintar un documento. El guardia
 * anti-N+1 de los tests transversales existe justo para esto.
 */
export interface ProductForDocument {
  id: string;
  sku: string;
  name: string;
  uomCode: string;
  salePrice: string;
  purchasePrice: string;
  currencyCode: string;
  priceIncludesTax: boolean;
  saleTax: { id: string; code: string; kind: string; rate: string } | null;
  purchaseTax: { id: string; code: string; kind: string; rate: string } | null;
}

export interface ProductOverview {
  total: number;
  goods: number;
  services: number;
  kits: number;
  inactive: number;
  withoutPrice: number;
  /** Productos que se venden por debajo de su costo: dinero que se pierde en cada venta. */
  belowCost: number;
}

export interface VariantRepository {
  listByProduct(tx: Tx, productId: string): Promise<ProductVariant[]>;
  findById(tx: Tx, id: string): Promise<ProductVariant | null>;
  findBySku(tx: Tx, organizationId: string, sku: string): Promise<ProductVariant | null>;
  save(tx: Tx, variant: ProductVariant): Promise<void>;
  update(tx: Tx, variant: ProductVariant): Promise<void>;
  softDelete(tx: Tx, id: string, at: Date): Promise<void>;
}

export interface UomRepository {
  list(tx: Tx, organizationId: string): Promise<Uom[]>;
  findById(tx: Tx, id: string): Promise<Uom | null>;
  findByCode(tx: Tx, organizationId: string, code: string): Promise<Uom | null>;
  save(tx: Tx, uom: Uom): Promise<void>;
  update(tx: Tx, uom: Uom): Promise<void>;
  delete(tx: Tx, id: string): Promise<void>;
  /** ¿Hay productos usando esta unidad? Borrarla los dejaría sin dimensión. */
  isInUse(tx: Tx, id: string): Promise<boolean>;
  seed(tx: Tx, organizationId: string): Promise<number>;
}

export interface CategoryNode {
  id: string;
  parentId: string | null;
  name: string;
  path: string;
  depth: number;
  description: string | null;
  isActive: boolean;
  productCount: number;
}

export interface CategoryRepository {
  tree(tx: Tx, organizationId: string): Promise<CategoryNode[]>;
  findById(tx: Tx, id: string): Promise<CategoryNode | null>;
  findByPath(tx: Tx, organizationId: string, path: string): Promise<CategoryNode | null>;
  save(tx: Tx, organizationId: string, node: Omit<CategoryNode, 'productCount'>): Promise<void>;
  update(tx: Tx, organizationId: string, node: Omit<CategoryNode, 'productCount'>): Promise<void>;
  /** Reescribe las rutas de toda la rama al mover o renombrar una categoría. */
  rewriteSubtree(tx: Tx, organizationId: string, oldPath: string, newPath: string): Promise<void>;
  delete(tx: Tx, id: string): Promise<void>;
  hasChildren(tx: Tx, id: string): Promise<boolean>;
  hasProducts(tx: Tx, id: string): Promise<boolean>;
}

export interface TaxRow extends Record<string, unknown> {
  id: string;
  code: string;
  name: string;
  kind: string;
  rate: string;
  is_withholding: boolean;
  applies_to: string;
  min_base: string | null;
  dian_tax_code: string | null;
  is_active: boolean;
}

export interface TaxRepository {
  list(tx: Tx, organizationId: string): Promise<TaxRow[]>;
  findById(tx: Tx, id: string): Promise<TaxRow | null>;
  findByCode(tx: Tx, organizationId: string, code: string): Promise<TaxRow | null>;
  save(tx: Tx, organizationId: string, tax: Omit<TaxRow, 'id'> & { id: string }): Promise<void>;
  update(tx: Tx, organizationId: string, tax: Omit<TaxRow, 'id'> & { id: string }): Promise<void>;
  delete(tx: Tx, id: string): Promise<void>;
  isInUse(tx: Tx, id: string): Promise<boolean>;
  seed(tx: Tx, organizationId: string): Promise<number>;
}

export interface PriceListRepository {
  list(tx: Tx, organizationId: string, kind?: 'SALE' | 'PURCHASE'): Promise<PriceListRecord[]>;
  findById(tx: Tx, id: string): Promise<PriceListRecord | null>;
  findDefault(tx: Tx, organizationId: string, kind: 'SALE' | 'PURCHASE'): Promise<PriceListRecord | null>;
  save(tx: Tx, list: PriceListRecord): Promise<void>;
  update(tx: Tx, list: PriceListRecord): Promise<void>;
  delete(tx: Tx, id: string): Promise<void>;
  clearDefault(tx: Tx, organizationId: string, kind: 'SALE' | 'PURCHASE'): Promise<void>;
  /**
   * Cadena de listas desde la indicada hasta su raíz.
   *
   * Se resuelve en una sola consulta recursiva: hacerlo con un bucle de
   * `findById` daría una consulta por nivel, y esto se ejecuta una vez por línea
   * de cada documento.
   */
  chain(tx: Tx, id: string): Promise<PriceListRef[]>;
  tiersFor(tx: Tx, listIds: readonly string[], productId: string, variantId: string | null): Promise<PriceTier[]>;
  listItems(tx: Tx, query: ListQuery, priceListId: string): Promise<ListResult<PriceItemRow>>;
  /** Devuelve el id real de la fila: en un conflicto gana el de la que ya existía. */
  saveItem(tx: Tx, item: PriceItemRecord): Promise<string>;
  deleteItem(tx: Tx, id: string): Promise<void>;
  findItem(tx: Tx, id: string): Promise<PriceItemRecord | null>;
  /** ¿Alguna lista deriva de ésta? Borrarla dejaría precios sin base. */
  hasDerived(tx: Tx, id: string): Promise<boolean>;
}

export interface PriceListRecord extends PriceListRef {
  organizationId: string;
  kind: 'SALE' | 'PURCHASE';
  isDefault: boolean;
}

export interface PriceItemRecord {
  id: string;
  organizationId: string;
  priceListId: string;
  productId: string;
  variantId: string | null;
  minQuantity: string;
  price: string;
}

export interface PriceItemRow extends Record<string, unknown> {
  id: string;
  product_id: string;
  variant_id: string | null;
  sku: string;
  name: string;
  min_quantity: string;
  price: string;
}

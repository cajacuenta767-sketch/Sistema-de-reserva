/** Formas que devuelve la API de catálogo (fechas como cadenas ISO). */

export interface Product {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  description: string | null;
  kind: 'GOOD' | 'SERVICE' | 'KIT';
  categoryId: string | null;
  uomId: string;
  saleUomId: string | null;
  purchaseUomId: string | null;
  salePrice: string;
  purchasePrice: string;
  currencyCode: string;
  priceIncludesTax: boolean;
  saleTaxId: string | null;
  purchaseTaxId: string | null;
  trackInventory: boolean;
  costMethod: 'AVERAGE' | 'FIFO' | 'STANDARD';
  standardCost: string;
  minStock: string | null;
  maxStock: string | null;
  tracking: 'NONE' | 'LOT' | 'SERIAL';
  brand: string | null;
  manufacturerSku: string | null;
  weightKg: string | null;
  isSellable: boolean;
  isPurchasable: boolean;
  isActive: boolean;
  createdAt: string;
}

export interface ProductVariant {
  id: string;
  productId: string;
  sku: string;
  name: string;
  attributes: Record<string, string>;
  priceDelta: string;
  isActive: boolean;
}

export interface TaxRef {
  id: string;
  code: string;
  name: string;
  /** Decide cómo se escribe la tarifa: el ReteICA se publica por mil. */
  kind: string;
  rate: string;
}

export interface ProductDetail {
  product: Product;
  variants: ProductVariant[];
  uom: { id: string; code: string; name: string; precision: number } | null;
  categoryPath: string | null;
  saleTax: TaxRef | null;
  purchaseTax: TaxRef | null;
  marginPercent: string | null;
}

export interface Uom {
  id: string;
  code: string;
  name: string;
  dimension: 'UNIT' | 'WEIGHT' | 'VOLUME' | 'LENGTH' | 'AREA' | 'TIME';
  factor: string;
  precision: number;
  dianCode: string | null;
  isBase: boolean;
  isActive: boolean;
}

export interface Category {
  id: string;
  parentId: string | null;
  name: string;
  path: string;
  depth: number;
  description: string | null;
  isActive: boolean;
  productCount: number;
}

export interface Tax {
  id: string;
  code: string;
  name: string;
  kind: 'VAT' | 'INC' | 'WITHHOLDING_INCOME' | 'WITHHOLDING_VAT' | 'WITHHOLDING_ICA' | 'OTHER';
  rate: string;
  is_withholding: boolean;
  applies_to: 'SALE' | 'PURCHASE' | 'BOTH';
  min_base: string | null;
  dian_tax_code: string | null;
  is_active: boolean;
}

export interface PriceList {
  id: string;
  name: string;
  kind: 'SALE' | 'PURCHASE';
  currencyCode: string;
  mode: 'FIXED' | 'DERIVED';
  basedOnId: string | null;
  adjustmentPercent: string;
  rounding: string;
  includesTax: boolean;
  validFrom: string | null;
  validTo: string | null;
  isDefault: boolean;
  isActive: boolean;
}

export interface PriceItemRow {
  id: string;
  product_id: string;
  variant_id: string | null;
  sku: string;
  name: string;
  min_quantity: string;
  price: string;
}

export interface ProductOverview {
  total: number;
  goods: number;
  services: number;
  kits: number;
  inactive: number;
  withoutPrice: number;
  belowCost: number;
}

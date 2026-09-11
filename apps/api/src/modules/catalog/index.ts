/** API pública del módulo de catálogo. */
export { catalogModule, type CatalogApi, type CatalogSeedResult } from './module.js';
export type { ProductForDocument } from './application/ports/CatalogRepositories.js';
export type { Product, ProductVariant, ProductKind } from './domain/Product.js';
export type { Uom, UomDimension, Quantity } from './domain/Uom.js';
export { convert, toBase, assertRepresentable, DEFAULT_UOMS } from './domain/Uom.js';
export {
  addTax,
  extractTax,
  marginPercent,
  resolvePrice,
  type ResolvedPrice,
} from './domain/Pricing.js';
export { COLOMBIAN_TAXES, UVT_2026, type TaxSeed } from './domain/ColombianTaxes.js';

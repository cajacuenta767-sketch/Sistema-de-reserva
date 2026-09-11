import { AppError } from '@erp/core';

/** Producto del catálogo. Todo documento de venta, compra o inventario lo referencia. */

export type ProductKind = 'GOOD' | 'SERVICE' | 'KIT';
export type CostMethod = 'AVERAGE' | 'FIFO' | 'STANDARD';
export type TrackingMode = 'NONE' | 'LOT' | 'SERIAL';

export interface Product {
  id: string;
  organizationId: string;
  sku: string;
  barcode: string | null;
  name: string;
  description: string | null;
  kind: ProductKind;
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
  costMethod: CostMethod;
  standardCost: string;
  minStock: string | null;
  maxStock: string | null;
  tracking: TrackingMode;
  incomeAccountId: string | null;
  expenseAccountId: string | null;
  inventoryAccountId: string | null;
  brand: string | null;
  manufacturerSku: string | null;
  weightKg: string | null;
  isSellable: boolean;
  isPurchasable: boolean;
  isActive: boolean;
  ownerMembershipId: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface ProductVariant {
  id: string;
  organizationId: string;
  productId: string;
  sku: string;
  barcode: string | null;
  name: string;
  attributes: Record<string, string>;
  priceDelta: string;
  weightKg: string | null;
  isActive: boolean;
}

/**
 * Normaliza un SKU: mayúsculas y sin espacios sobrantes.
 *
 * Los SKU se teclean, se pegan desde Excel y se leen con lector de códigos. Sin
 * normalizar, "ABC-1", "abc-1" y "ABC-1 " son tres productos distintos y el
 * índice único no lo impide, que es exactamente cuando el catálogo se vuelve
 * inservible.
 */
export const normalizeSku = (raw: string): string => raw.trim().toUpperCase().replace(/\s+/g, ' ');

/**
 * SKU automático a partir del nombre, para quien no lleva codificación propia.
 *
 * Obligar a inventar un código antes de poder guardar el primer producto es la
 * clase de fricción que hace que la gente escriba "1", "2", "3".
 */
export const skuFromName = (name: string, sequence: number): string => {
  const slug = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 12)
    .replace(/-$/, '');
  return `${slug || 'PROD'}-${String(sequence).padStart(4, '0')}`;
};

/**
 * Reglas que un producto debe cumplir siempre.
 *
 * La base de datos ya impide las dos combinaciones imposibles, pero un CHECK
 * violado sale como un error de PostgreSQL que nadie puede leer. Esto da el
 * mismo rechazo con un mensaje que dice qué hacer.
 */
export const assertConsistent = (product: {
  kind: ProductKind;
  trackInventory: boolean;
  tracking: TrackingMode;
  isSellable: boolean;
  isPurchasable: boolean;
}): void => {
  if (product.kind === 'SERVICE' && product.trackInventory) {
    throw AppError.rule(
      'Un servicio no lleva existencias: no se puede almacenar una hora de trabajo',
    );
  }
  if (!product.trackInventory && product.tracking !== 'NONE') {
    throw AppError.rule(
      'Para controlar lotes o series hay que llevar existencias del producto',
    );
  }
  if (!product.isSellable && !product.isPurchasable) {
    throw AppError.rule('Un producto que ni se vende ni se compra no sirve para nada');
  }
};

/** Nombre de una variante a partir de sus atributos: "Camisa · azul / M". */
export const variantName = (productName: string, attributes: Record<string, string>): string => {
  const values = Object.values(attributes).filter((v) => v.trim().length > 0);
  return values.length > 0 ? `${productName} · ${values.join(' / ')}` : productName;
};

/** Ruta materializada de una categoría, a partir de la de su padre. */
export const categoryPath = (parentPath: string | null, name: string): string =>
  parentPath ? `${parentPath} / ${name.trim()}` : name.trim();

/**
 * Una categoría no puede colgar de su propia descendencia.
 *
 * Se comprueba por la ruta y no por el árbol: `path` ya contiene toda la rama,
 * así que basta una comparación de prefijo en vez de recorrer los hijos.
 */
export const assertNotOwnDescendant = (movingPath: string, newParentPath: string | null): void => {
  if (newParentPath === null) return;
  if (newParentPath === movingPath || newParentPath.startsWith(`${movingPath} / `)) {
    throw AppError.rule(
      `No se puede mover "${movingPath}" dentro de sí misma: quedaría un ciclo en el árbol`,
    );
  }
};

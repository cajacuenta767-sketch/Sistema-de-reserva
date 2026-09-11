import { AppError, Decimal } from '@erp/core';

/**
 * Resolución de precio.
 *
 * "¿A cuánto le vendo esto a este cliente?" tiene más respuestas de las que
 * parece: depende de la lista asignada al cliente, de cuánto compra, de si la
 * lista está vigente, de si es una lista derivada de otra, y de si el precio
 * lleva IVA dentro. Todo eso se resuelve AQUÍ, en una función pura, y no en la
 * pantalla de facturación. Si viviera en la pantalla, el pedido, la cotización y
 * la factura recurrente darían tres precios distintos para la misma venta.
 */

export type PriceListMode = 'FIXED' | 'DERIVED';

export interface PriceListRef {
  id: string;
  name: string;
  mode: PriceListMode;
  basedOnId: string | null;
  /** Positivo = descuento. Negativo = recargo. */
  adjustmentPercent: string;
  /** Múltiplo al que se redondea el resultado. 0 = no redondear. */
  rounding: string;
  includesTax: boolean;
  currencyCode: string;
  validFrom: string | null;
  validTo: string | null;
  isActive: boolean;
}

/** Escala de precio: rige desde `minQuantity` unidades. */
export interface PriceTier {
  priceListId: string;
  minQuantity: string;
  price: string;
}

export interface PriceResolutionInput {
  /** Precio del producto, el que se usa si ninguna lista dice otra cosa. */
  basePrice: string;
  quantity: string;
  /** Fecha del documento, no la de hoy: una factura de marzo usa precios de marzo. */
  on: string;
  /** Cadena de listas, de la aplicada hacia su base. Vacía = precio del producto. */
  chain: readonly PriceListRef[];
  /** Escalas de todas las listas de la cadena. */
  tiers: readonly PriceTier[];
}

export interface ResolvedPrice {
  price: string;
  /** Qué lista fijó el precio, o `null` si salió del producto. */
  sourceListId: string | null;
  sourceLabel: string;
  includesTax: boolean;
  currencyCode: string;
  /** Escalón aplicado, cuando el precio vino de una escala por cantidad. */
  appliedTier: string | null;
}

const isWithinDates = (list: PriceListRef, on: string): boolean =>
  (list.validFrom === null || list.validFrom <= on) && (list.validTo === null || list.validTo >= on);

/** La escala vigente es la de mayor `minQuantity` que no supere lo pedido. */
export const bestTier = (tiers: readonly PriceTier[], listId: string, quantity: string): PriceTier | null => {
  const qty = new Decimal(quantity);
  let best: PriceTier | null = null;
  for (const tier of tiers) {
    if (tier.priceListId !== listId) continue;
    if (qty.lessThan(tier.minQuantity)) continue;
    if (best === null || new Decimal(tier.minQuantity).greaterThan(best.minQuantity)) best = tier;
  }
  return best;
};

/**
 * Redondea al múltiplo indicado.
 *
 * En Colombia los precios se manejan en centenas: las monedas de menos de 50
 * pesos dejaron de circular, así que un precio de 23.847 se cobra como 23.800 o
 * 23.900 de todas formas. Dejarlo sin redondear traslada el problema a la caja,
 * donde cada cajero decide distinto.
 */
export const roundToMultiple = (value: Decimal, multiple: string): Decimal => {
  const step = new Decimal(multiple);
  if (step.isZero()) return value.toDecimalPlaces(4);
  return value.dividedBy(step).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).times(step);
};

/**
 * Resuelve el precio recorriendo la cadena de listas.
 *
 * La cadena llega ordenada de la lista aplicada hacia su base. Se busca un
 * precio explícito en la primera lista vigente que lo tenga; si ninguna lo
 * tiene, se parte del precio del producto. Después se aplican, en orden inverso,
 * los ajustes porcentuales de las listas derivadas que no fijaron precio.
 */
export const resolvePrice = (input: PriceResolutionInput): ResolvedPrice => {
  if (new Decimal(input.quantity).lessThanOrEqualTo(0)) {
    throw AppError.rule('La cantidad debe ser mayor que cero para poder calcular un precio');
  }

  const usable = input.chain.filter((list) => list.isActive && isWithinDates(list, input.on));
  const head = usable[0] ?? null;

  // Un precio explícito gana sobre cualquier porcentaje: es una decisión
  // comercial tomada producto a producto, y sobrescribirla con la fórmula de la
  // lista derivada anularía justo la excepción que alguien configuró a mano.
  for (let i = 0; i < usable.length; i += 1) {
    const list = usable[i];
    if (!list) continue;
    const tier = bestTier(input.tiers, list.id, input.quantity);
    if (!tier) continue;

    // Las listas derivadas que quedan por encima sí se aplican sobre ese precio.
    const price = usable
      .slice(0, i)
      .reverse()
      .reduce((acc, derived) => applyAdjustment(acc, derived), new Decimal(tier.price));

    return {
      price: roundToMultiple(price, head?.rounding ?? '0').toFixed(4),
      sourceListId: list.id,
      sourceLabel: list.name,
      includesTax: head?.includesTax ?? false,
      currencyCode: head?.currencyCode ?? 'COP',
      // Normalizado: la base devuelve `NUMERIC(19,6)` como "50.000000", y ese
      // texto acaba en la pantalla tal cual ("desde 50.000000 unidades").
      appliedTier: new Decimal(tier.minQuantity).equals(1)
        ? null
        : new Decimal(tier.minQuantity).toString(),
    };
  }

  const price = usable.reduceRight((acc, list) => applyAdjustment(acc, list), new Decimal(input.basePrice));

  return {
    price: roundToMultiple(price, head?.rounding ?? '0').toFixed(4),
    sourceListId: head?.id ?? null,
    sourceLabel: head?.name ?? 'Precio del producto',
    includesTax: head?.includesTax ?? false,
    currencyCode: head?.currencyCode ?? 'COP',
    appliedTier: null,
  };
};

const applyAdjustment = (price: Decimal, list: PriceListRef): Decimal => {
  if (list.mode !== 'DERIVED') return price;
  const factor = new Decimal(100).minus(list.adjustmentPercent).dividedBy(100);
  const adjusted = price.times(factor);
  // Un descuento del 120 % daría un precio negativo: se cobra cero y el error se
  // corrige en la lista, no en la venta.
  return adjusted.isNegative() ? new Decimal(0) : adjusted;
};

/**
 * Separa el impuesto de un precio que lo lleva incluido.
 *
 * El comercio al detal cotiza con IVA dentro ("$11.900"), pero la factura debe
 * mostrar base e impuesto por separado. Hacerlo al revés —calcular el 19 % sobre
 * 11.900— da 2.261 en vez de 1.900, y la factura no cuadra con la etiqueta.
 */
export const extractTax = (grossPrice: string, ratePercent: string): { base: string; tax: string } => {
  const gross = new Decimal(grossPrice);
  const divisor = new Decimal(100).plus(ratePercent).dividedBy(100);
  const base = gross.dividedBy(divisor).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
  return { base: base.toFixed(4), tax: gross.minus(base).toFixed(4) };
};

/** Añade el impuesto a un precio que no lo lleva. */
export const addTax = (netPrice: string, ratePercent: string): string =>
  new Decimal(netPrice)
    .times(new Decimal(100).plus(ratePercent).dividedBy(100))
    .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
    .toFixed(4);

/** Margen sobre el costo, en porcentaje. Negativo significa vender con pérdida. */
export const marginPercent = (salePrice: string, cost: string): string | null => {
  const price = new Decimal(salePrice);
  if (price.isZero()) return null;
  return price.minus(cost).dividedBy(price).times(100).toDecimalPlaces(2).toFixed(2);
};

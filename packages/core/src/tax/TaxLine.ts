import { Decimal, Money } from '../money/Money.js';

/**
 * Cálculo de importes de una línea de documento (cotización, factura, orden de
 * compra, factura de proveedor). Es una función PURA: se prueba sin base de datos
 * y es el punto donde un error cuesta dinero real, así que vive aquí y no en un
 * repositorio ni en un controlador.
 */

export type TaxKind =
  | 'VAT' // IVA
  | 'INC' // Impuesto nacional al consumo
  | 'WITHHOLDING_INCOME' // ReteFuente
  | 'WITHHOLDING_VAT' // ReteIVA
  | 'WITHHOLDING_ICA' // ReteICA
  | 'OTHER';

export interface TaxDef {
  id: string;
  code: string;
  kind: TaxKind;
  /** Porcentaje, ej. 19 para el 19 %. */
  rate: Decimal.Value;
  isWithholding: boolean;
  /** Si es compuesto, su base incluye los impuestos no compuestos ya calculados. */
  isCompound?: boolean;
}

export interface LineInput {
  quantity: Decimal.Value;
  unitPrice: Decimal.Value;
  /** Descuento porcentual sobre el bruto (0-100). */
  discountPercent?: Decimal.Value;
  /** Descuento de importe fijo. Se aplica después del porcentual. */
  discountAmount?: Decimal.Value;
  taxes?: readonly TaxDef[];
  currency: string;
}

export interface ComputedTax {
  taxId: string;
  code: string;
  kind: TaxKind;
  rate: string;
  base: Money;
  amount: Money;
  isWithholding: boolean;
}

export interface LineTotals {
  gross: Money;
  discount: Money;
  /** Base gravable: bruto menos descuentos. */
  subtotal: Money;
  taxes: ComputedTax[];
  /** Suma de impuestos que se suman al total (IVA, INC). */
  taxTotal: Money;
  /** Suma de retenciones, que restan del total a pagar. */
  withholdingTotal: Money;
  /** subtotal + taxTotal (las retenciones NO se restan aquí: se agregan a nivel de documento). */
  total: Money;
}

/**
 * Precisión intermedia: se calcula con 6 decimales y solo se redondea a la escala
 * de la moneda en los importes finales. Redondear en cada paso produce desviaciones
 * de varios pesos en facturas de muchas líneas.
 */
const INTERMEDIATE_DP = 6;

export const computeLineTotals = (line: LineInput): LineTotals => {
  const { currency } = line;
  const qty = new Decimal(line.quantity);
  const price = new Decimal(line.unitPrice);

  const gross = Money.of(qty.times(price).toDecimalPlaces(INTERMEDIATE_DP), currency);

  const pctDiscount = gross.percent(line.discountPercent ?? 0);
  const fixedDiscount = Money.of(line.discountAmount ?? 0, currency);
  const discount = pctDiscount.plus(fixedDiscount);

  const subtotal = gross.minus(discount);

  const defs = line.taxes ?? [];
  const simple = defs.filter((t) => !t.isCompound);
  const compound = defs.filter((t) => t.isCompound);

  const computed: ComputedTax[] = [];

  const addTax = (t: TaxDef, base: Money): void => {
    computed.push({
      taxId: t.id,
      code: t.code,
      kind: t.kind,
      rate: new Decimal(t.rate).toString(),
      base: base.round(),
      amount: base.percent(t.rate).round(),
      isWithholding: t.isWithholding,
    });
  };

  for (const t of simple) addTax(t, subtotal);

  // Los impuestos compuestos se calculan sobre la base más los impuestos
  // no retenidos ya acumulados (ej. un impuesto que grava el IVA).
  const nonWithheld = computed
    .filter((c) => !c.isWithholding)
    .reduce((acc, c) => acc.plus(c.amount), Money.zero(currency));
  for (const t of compound) addTax(t, subtotal.plus(nonWithheld));

  const taxTotal = computed
    .filter((c) => !c.isWithholding)
    .reduce((acc, c) => acc.plus(c.amount), Money.zero(currency));
  const withholdingTotal = computed
    .filter((c) => c.isWithholding)
    .reduce((acc, c) => acc.plus(c.amount), Money.zero(currency));

  return {
    gross: gross.round(),
    discount: discount.round(),
    subtotal: subtotal.round(),
    taxes: computed,
    taxTotal: taxTotal.round(),
    withholdingTotal: withholdingTotal.round(),
    total: subtotal.plus(taxTotal).round(),
  };
};

/** Agrega los totales de varias líneas en los totales de un documento. */
export interface DocumentTotals {
  subtotal: Money;
  discountTotal: Money;
  taxTotal: Money;
  withholdingTotal: Money;
  /** subtotal + impuestos. Lo que se factura antes de retenciones. */
  total: Money;
  /** total − retenciones. Lo que el cliente efectivamente paga. */
  netPayable: Money;
  /** Impuestos agrupados por definición, para la cabecera del documento. */
  taxesByDefinition: ComputedTax[];
}

export const aggregateDocumentTotals = (lines: readonly LineTotals[], currency: string): DocumentTotals => {
  const subtotal = Money.sum(
    lines.map((l) => l.subtotal),
    currency,
  );
  const discountTotal = Money.sum(
    lines.map((l) => l.discount),
    currency,
  );
  const taxTotal = Money.sum(
    lines.map((l) => l.taxTotal),
    currency,
  );
  const withholdingTotal = Money.sum(
    lines.map((l) => l.withholdingTotal),
    currency,
  );

  const grouped = new Map<string, ComputedTax>();
  for (const line of lines) {
    for (const t of line.taxes) {
      const prev = grouped.get(t.taxId);
      grouped.set(
        t.taxId,
        prev ? { ...prev, base: prev.base.plus(t.base), amount: prev.amount.plus(t.amount) } : { ...t },
      );
    }
  }

  const total = subtotal.plus(taxTotal);
  return {
    subtotal,
    discountTotal,
    taxTotal,
    withholdingTotal,
    total,
    netPayable: total.minus(withholdingTotal),
    taxesByDefinition: [...grouped.values()],
  };
};

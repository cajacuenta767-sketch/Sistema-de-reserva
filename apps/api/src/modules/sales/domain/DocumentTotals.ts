import { AppError, Decimal, Money, aggregateDocumentTotals, computeLineTotals } from '@erp/core';
import type { LineTotals, TaxDef } from '@erp/core';
import { computeWithholdings, totalWithheld, type ComputedWithholding, type WithholdingDef } from './Withholding.js';

/**
 * Totales de un documento de venta.
 *
 * Es la función que decide cuánto se cobra, así que es pura, vive aquí y se
 * prueba sin base de datos. La misma la usan la cotización, el pedido y la
 * factura: si cada una hiciera su cuenta, convertir una cotización en factura
 * podría cambiar el total sin que nadie tocara nada.
 */

export interface DocumentLineInput {
  productId: string | null;
  variantId?: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
  discountPercent?: string;
  /** Impuestos que se suman: IVA, INC. Las retenciones van aparte. */
  taxes?: readonly TaxDef[];
}

export interface DocumentTotalsInput {
  lines: readonly DocumentLineInput[];
  currency: string;
  /**
   * Descuento sobre el total del documento, en porcentaje.
   *
   * Se reparte entre las líneas ANTES de calcular impuestos, no se resta del
   * total al final: el IVA se liquida sobre la base ya descontada, y restarlo
   * después dejaría una factura donde el IVA no corresponde a su base. La DIAN
   * rechaza esa factura.
   */
  globalDiscountPercent?: string;
  withholdings?: readonly WithholdingDef[];
}

export interface DocumentLineResult extends LineTotals {
  index: number;
  description: string;
}

export interface SalesDocumentTotals {
  lines: DocumentLineResult[];
  subtotal: Money;
  discountTotal: Money;
  taxTotal: Money;
  /** Lo que dice la factura. Las retenciones NO se restan de aquí. */
  total: Money;
  withholdings: ComputedWithholding[];
  withholdingTotal: Money;
  /** Lo que el cliente transfiere: total menos retenciones. */
  netPayable: Money;
  taxesByDefinition: ReturnType<typeof aggregateDocumentTotals>['taxesByDefinition'];
}

export const computeDocumentTotals = (input: DocumentTotalsInput): SalesDocumentTotals => {
  if (input.lines.length === 0) {
    throw AppError.rule('Un documento necesita al menos una línea');
  }

  const globalDiscount = new Decimal(input.globalDiscountPercent ?? 0);
  if (globalDiscount.lessThan(0) || globalDiscount.greaterThan(100)) {
    throw AppError.rule('El descuento global tiene que estar entre 0 y 100 %');
  }

  const lines = input.lines.map((line, index) => {
    assertLine(line, index);

    // Los dos descuentos se acumulan de forma compuesta, no sumada: un 10 % de
    // línea y un 10 % global dejan el 81 %, no el 80 %. Sumarlos daría un total
    // que no cuadra con lo que el cliente calcula a mano y genera una reclamación.
    const lineDiscount = new Decimal(line.discountPercent ?? 0);
    const remaining = new Decimal(100)
      .minus(lineDiscount)
      .times(new Decimal(100).minus(globalDiscount))
      .dividedBy(100);
    const effectiveDiscount = new Decimal(100).minus(remaining);

    const totals = computeLineTotals({
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discountPercent: effectiveDiscount,
      ...(line.taxes ? { taxes: line.taxes } : {}),
      currency: input.currency,
    });

    return { ...totals, index, description: line.description };
  });

  const aggregated = aggregateDocumentTotals(lines, input.currency);

  // El IVA es la base del ReteIVA; el INC no se retiene.
  const vatTotal = Money.sum(
    aggregated.taxesByDefinition.filter((t) => t.kind === 'VAT').map((t) => t.amount),
    input.currency,
  );

  const withholdings = computeWithholdings({
    taxableBase: aggregated.subtotal,
    vatTotal,
    withholdings: input.withholdings ?? [],
    currency: input.currency,
  });
  const withholdingTotal = totalWithheld(withholdings, input.currency);

  return {
    lines,
    subtotal: aggregated.subtotal,
    discountTotal: aggregated.discountTotal,
    taxTotal: aggregated.taxTotal,
    total: aggregated.total,
    withholdings,
    withholdingTotal,
    netPayable: aggregated.total.minus(withholdingTotal),
    taxesByDefinition: aggregated.taxesByDefinition,
  };
};

const assertLine = (line: DocumentLineInput, index: number): void => {
  const position = index + 1;
  if (!line.description.trim()) {
    throw AppError.rule(`La línea ${position} necesita una descripción`);
  }
  const quantity = new Decimal(line.quantity);
  if (quantity.lessThanOrEqualTo(0)) {
    // Una cantidad negativa convierte una venta en una devolución encubierta que
    // no deja rastro: las devoluciones son notas de crédito.
    throw AppError.rule(`La cantidad de la línea ${position} tiene que ser mayor que cero`);
  }
  if (new Decimal(line.unitPrice).lessThan(0)) {
    throw AppError.rule(`El precio de la línea ${position} no puede ser negativo`);
  }
  const discount = new Decimal(line.discountPercent ?? 0);
  if (discount.lessThan(0) || discount.greaterThan(100)) {
    throw AppError.rule(`El descuento de la línea ${position} tiene que estar entre 0 y 100 %`);
  }
};

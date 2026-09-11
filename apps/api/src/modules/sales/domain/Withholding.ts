import { Decimal, Money } from '@erp/core';

/**
 * Retenciones colombianas.
 *
 * Se calculan sobre el DOCUMENTO, no sobre cada línea, y esa diferencia no es
 * un matiz: la ley fija una base mínima (27 UVT para compras, 4 para servicios)
 * por debajo de la cual no se retiene. Una factura de diez líneas de $100.000
 * tiene una base de $1.000.000, que supera el mínimo, mientras que ninguna de
 * sus líneas lo alcanza. Calculándolas línea a línea, esa factura no retendría
 * nada y la empresa dejaría de practicar una retención obligatoria.
 *
 * Por eso `computeLineTotals` de `@erp/core` sirve para IVA e INC —que sí son
 * por línea— y las retenciones se resuelven aquí, con el documento completo a
 * la vista.
 */

export interface WithholdingDef {
  id: string;
  code: string;
  name: string;
  kind: 'WITHHOLDING_INCOME' | 'WITHHOLDING_VAT' | 'WITHHOLDING_ICA';
  /** Porcentaje: 2.5 para el 2,5 %. */
  rate: string;
  /** Base mínima en pesos. `null` = se retiene siempre. */
  minBase: string | null;
}

export interface ComputedWithholding {
  taxId: string;
  code: string;
  name: string;
  kind: WithholdingDef['kind'];
  rate: string;
  base: Money;
  amount: Money;
  /** Por qué no se retuvo, cuando el importe es cero. */
  skippedReason: string | null;
}

export interface WithholdingInput {
  /** Base gravable del documento: subtotal después de descuentos. */
  taxableBase: Money;
  /** IVA del documento; es la base del ReteIVA, no el subtotal. */
  vatTotal: Money;
  withholdings: readonly WithholdingDef[];
  currency: string;
}

/**
 * Calcula las retenciones de un documento.
 *
 * Cada tipo se aplica sobre SU base: la ReteFuente y el ReteICA sobre la base
 * gravable, y el ReteIVA sobre el IVA facturado —no sobre el subtotal—. Un
 * ReteIVA del 15 % sobre la base en lugar de sobre el IVA retiene casi ocho
 * veces de más.
 */
export const computeWithholdings = (input: WithholdingInput): ComputedWithholding[] =>
  input.withholdings.map((def) => {
    const base = def.kind === 'WITHHOLDING_VAT' ? input.vatTotal : input.taxableBase;

    // La base mínima se compara SIEMPRE contra la base gravable del documento,
    // aunque la retención se calcule sobre el IVA: así lo fija la norma.
    const threshold = def.minBase === null ? null : new Decimal(def.minBase);
    const belowThreshold = threshold !== null && new Decimal(input.taxableBase.amount).lessThan(threshold);

    if (belowThreshold) {
      return {
        taxId: def.id,
        code: def.code,
        name: def.name,
        kind: def.kind,
        rate: def.rate,
        base: Money.zero(input.currency),
        amount: Money.zero(input.currency),
        skippedReason:
          `La base del documento no llega al mínimo de ${formatCop(def.minBase!)} ` +
          `que exige ${def.code}`,
      };
    }

    return {
      taxId: def.id,
      code: def.code,
      name: def.name,
      kind: def.kind,
      rate: def.rate,
      base: base.round(),
      amount: base.percent(def.rate).round(),
      skippedReason: null,
    };
  });

/** Suma de lo retenido. Es lo que el cliente descuenta al pagar. */
export const totalWithheld = (items: readonly ComputedWithholding[], currency: string): Money =>
  Money.sum(
    items.map((i) => i.amount),
    currency,
  );

const formatCop = (value: string): string =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(
    Number(value),
  );

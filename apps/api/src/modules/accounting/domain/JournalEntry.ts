import { AppError, Decimal, Money } from '@erp/core';
import type { AccountRole } from './AccountRoles.js';

/**
 * El asiento contable como función pura.
 *
 * Todo lo que decide si la contabilidad es correcta vive aquí y no toca la base
 * de datos: se puede probar con una tabla de casos y sin levantar nada. La base
 * de datos repite las mismas comprobaciones porque es la última línea de
 * defensa —varios módulos escribirán asientos—, pero el mensaje que lee una
 * persona sale de aquí.
 */

export type EntrySide = 'DEBIT' | 'CREDIT';

/** Escala de trabajo. La misma que usan las columnas `numeric(19,4)`. */
export const ENTRY_DECIMALS = 4;

export interface EntryLineDraft {
  /** Cuenta por rol (lo normal) o por id ya resuelto (asiento manual). */
  role?: AccountRole;
  accountId?: string;
  side: EntrySide;
  /** Importe en la moneda del asiento. Siempre positivo. */
  amount: Money;
  description: string;
  partyId?: string | null;
  costCenterId?: string | null;
  branchId?: string | null;
  reference?: string | null;
}

export interface EntryDraft {
  journalType: JournalType;
  date: string;
  memo: string;
  sourceType: string;
  sourceId: string | null;
  currency: string;
  /** Tasa a la moneda funcional el día del documento. */
  exchangeRate: string;
  lines: readonly EntryLineDraft[];
}

export type JournalType =
  | 'SALES'
  | 'PURCHASES'
  | 'CASH'
  | 'PAYROLL'
  | 'GENERAL'
  | 'OPENING'
  | 'CLOSING'
  | 'INVENTORY';

export interface EntryTotals {
  debit: Money;
  credit: Money;
  difference: Money;
}

export const entryTotals = (lines: readonly EntryLineDraft[], currency: string): EntryTotals => {
  let debit = Money.zero(currency);
  let credit = Money.zero(currency);
  for (const line of lines) {
    if (line.side === 'DEBIT') debit = debit.plus(line.amount);
    else credit = credit.plus(line.amount);
  }
  return { debit, credit, difference: debit.minus(credit) };
};

export const isBalanced = (lines: readonly EntryLineDraft[], currency: string): boolean =>
  entryTotals(lines, currency).difference.round(ENTRY_DECIMALS).isZero();

/**
 * Un asiento con importes negativos no existe.
 *
 * Restar al débito y sumar al crédito dan el mismo total, pero el libro mayor
 * deja de poder leerse: una cuenta con "débitos −500" no se puede explicar a
 * nadie, y el balance de prueba, que suma columnas, muestra cifras que no
 * corresponden al movimiento real.
 */
export const assertPositiveAmounts = (lines: readonly EntryLineDraft[]): void => {
  for (const line of lines) {
    if (line.amount.isNegative()) {
      throw AppError.rule(
        `La línea "${line.description}" tiene un importe negativo. ` +
          'Para mover en sentido contrario se cambia de lado, no de signo.',
      );
    }
  }
};

export const assertBalanced = (draft: EntryDraft): void => {
  const nonZero = draft.lines.filter((l) => !l.amount.round(ENTRY_DECIMALS).isZero());
  if (nonZero.length === 0) {
    throw AppError.rule(`El asiento "${draft.memo}" no tiene movimiento`);
  }
  if (nonZero.length < 2) {
    throw AppError.rule(
      `El asiento "${draft.memo}" tiene una sola línea: un asiento mueve al menos dos cuentas`,
    );
  }
  assertPositiveAmounts(draft.lines);

  const totals = entryTotals(draft.lines, draft.currency);
  const diff = totals.difference.round(ENTRY_DECIMALS);
  if (!diff.isZero()) {
    throw AppError.rule(
      `El asiento "${draft.memo}" no cuadra por ${diff.abs().toDb(ENTRY_DECIMALS)} ${draft.currency}: ` +
        `débitos ${totals.debit.toDb(ENTRY_DECIMALS)} contra créditos ${totals.credit.toDb(ENTRY_DECIMALS)}`,
      {
        debit: totals.debit.toDb(ENTRY_DECIMALS),
        credit: totals.credit.toDb(ENTRY_DECIMALS),
        difference: diff.toDb(ENTRY_DECIMALS),
      },
    );
  }
};

/** Descarta las líneas en cero: un movimiento de 0 no dice nada y ensucia el mayor. */
export const withoutZeroLines = (draft: EntryDraft): EntryDraft => ({
  ...draft,
  lines: draft.lines.filter((l) => !l.amount.round(ENTRY_DECIMALS).isZero()),
});

export interface BaseAmounts {
  debit: string;
  credit: string;
  baseDebit: string;
  baseCredit: string;
}

/**
 * Convierte cada línea a la moneda funcional y cuadra el residuo.
 *
 * Redondear línea a línea puede descuadrar por centavos: 3 líneas de 33,333 USD
 * a 4.000,50 son 133.350,00 sumadas y 133.349,99 convertidas una a una. Ese
 * centavo es real y tiene que ir a alguna parte; va a la cuenta de ajuste al
 * peso, que existe para eso y solo para eso.
 *
 * El residuo se tolera hasta un límite deliberadamente bajo —un peso por línea—
 * porque un descuadre mayor no es redondeo: es un error de cálculo, y taparlo
 * con un ajuste convertiría un fallo detectable en una cifra plausible.
 */
export const convertToBase = (
  draft: EntryDraft,
  baseCurrency: string,
): { lines: (EntryLineDraft & BaseAmounts)[]; rounding: Money } => {
  const rate = new Decimal(draft.exchangeRate);
  const sameCurrency = draft.currency.toUpperCase() === baseCurrency.toUpperCase();

  const lines = draft.lines.map((line) => {
    const base = sameCurrency
      ? line.amount.round(ENTRY_DECIMALS)
      : line.amount.convert(baseCurrency, rate).round(ENTRY_DECIMALS);
    const amount = line.amount.round(ENTRY_DECIMALS);
    return {
      ...line,
      debit: line.side === 'DEBIT' ? amount.toDb(ENTRY_DECIMALS) : '0',
      credit: line.side === 'CREDIT' ? amount.toDb(ENTRY_DECIMALS) : '0',
      baseDebit: line.side === 'DEBIT' ? base.toDb(ENTRY_DECIMALS) : '0',
      baseCredit: line.side === 'CREDIT' ? base.toDb(ENTRY_DECIMALS) : '0',
    };
  });

  let baseDebit = Money.zero(baseCurrency);
  let baseCredit = Money.zero(baseCurrency);
  for (const line of lines) {
    baseDebit = baseDebit.plus(Money.fromDb(line.baseDebit, baseCurrency));
    baseCredit = baseCredit.plus(Money.fromDb(line.baseCredit, baseCurrency));
  }

  return { lines, rounding: baseDebit.minus(baseCredit) };
};

/** Tope del ajuste por redondeo: un peso por línea. Más que eso es un error. */
export const roundingTolerance = (lineCount: number, currency: string): Money =>
  Money.of(Math.max(lineCount, 1), currency);

/** Las cuatro columnas de importe de una línea ya escrita. */
export interface SidedAmounts {
  debit: string;
  credit: string;
  baseDebit: string;
  baseCredit: string;
}

/**
 * Invierte una línea para reversarla.
 *
 * Se intercambian las COLUMNAS, no se cambian los signos. Un asiento de
 * reversión con importes negativos cuadraría igual y volvería ilegible el libro
 * mayor: una cuenta con "débitos −500" no se le puede explicar a nadie, y el
 * balance de prueba, que suma columnas, mostraría cifras que no corresponden a
 * ningún movimiento real.
 */
export const swapSides = <T extends SidedAmounts>(line: T): T => ({
  ...line,
  debit: line.credit,
  credit: line.debit,
  baseDebit: line.baseCredit,
  baseCredit: line.baseDebit,
});

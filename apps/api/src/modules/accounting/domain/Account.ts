import { Decimal } from '@erp/core';

/**
 * La cuenta contable y las reglas que se derivan SOLO de su código.
 *
 * En el PUC colombiano la jerarquía ES el código: `1` es la clase Activo, `11`
 * el grupo Disponible, `1105` la cuenta Caja y `110505` la subcuenta Caja
 * general. Ninguna tabla de padres puede contradecir eso, así que el padre se
 * deduce del código y la columna `parent_id` solo lo materializa para que las
 * consultas del balance no tengan que hacer `LIKE '1105%'`, que no usa índice.
 */

export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE' | 'COST' | 'MEMORANDUM';
export type AccountNature = 'DEBIT' | 'CREDIT';
/** Dónde aparece la cuenta: balance general, estado de resultados o ninguno. */
export type Statement = 'BALANCE' | 'RESULTS' | 'MEMORANDUM';

/** Longitudes con nombre en el PUC. Un código de 3 o 5 dígitos no existe. */
export const PUC_LEVELS = [1, 2, 4, 6, 8] as const;
export type PucLevel = (typeof PUC_LEVELS)[number];

export const LEVEL_NAMES: Record<number, string> = {
  1: 'Clase',
  2: 'Grupo',
  4: 'Cuenta',
  6: 'Subcuenta',
  8: 'Auxiliar',
};

/**
 * Clase (primer dígito) → tipo. Es la tabla del Decreto 2650 y no se negocia:
 * una cuenta que empieza por 4 es un ingreso aunque se llame como uno quiera.
 */
const TYPE_BY_CLASS: Record<string, AccountType> = {
  '1': 'ASSET',
  '2': 'LIABILITY',
  '3': 'EQUITY',
  '4': 'INCOME',
  '5': 'EXPENSE',
  '6': 'COST',
  '7': 'COST',
  '8': 'MEMORANDUM',
  '9': 'MEMORANDUM',
};

export const typeForCode = (code: string): AccountType | null => TYPE_BY_CLASS[code[0] ?? ''] ?? null;

/**
 * Naturaleza por defecto del tipo.
 *
 * Es un DEFECTO, no una ley: las cuentas de valuación llevan la contraria a su
 * clase a propósito. La depreciación acumulada (1592) es un activo de
 * naturaleza crédito, y las devoluciones en ventas (4175) un ingreso de
 * naturaleza débito. Forzar la naturaleza por la clase las haría restar al
 * revés y el balance cuadraría con las cifras cambiadas de signo.
 */
export const defaultNatureFor = (type: AccountType): AccountNature =>
  type === 'ASSET' || type === 'EXPENSE' || type === 'COST' ? 'DEBIT' : 'CREDIT';

export const statementFor = (type: AccountType): Statement => {
  if (type === 'MEMORANDUM') return 'MEMORANDUM';
  return type === 'ASSET' || type === 'LIABILITY' || type === 'EQUITY' ? 'BALANCE' : 'RESULTS';
};

/** Las cuentas de resultado se cierran contra patrimonio al terminar el año. */
export const closesAtYearEnd = (type: AccountType): boolean => statementFor(type) === 'RESULTS';

export const isValidPucCode = (code: string): boolean =>
  /^[0-9]+$/.test(code) &&
  code[0] !== '0' &&
  (PUC_LEVELS as readonly number[]).includes(code.length);

export const assertValidPucCode = (code: string): void => {
  if (!/^[0-9]+$/.test(code)) throw new Error(`El código contable "${code}" debe ser numérico`);
  if (code[0] === '0') throw new Error(`El código contable "${code}" no puede empezar por 0`);
  if (!(PUC_LEVELS as readonly number[]).includes(code.length)) {
    throw new Error(
      `El código "${code}" tiene ${code.length} dígitos: en el PUC solo existen ` +
        `${PUC_LEVELS.join(', ')} (clase, grupo, cuenta, subcuenta, auxiliar)`,
    );
  }
};

/** Código del padre inmediato, o `null` si es una clase. */
export const parentCodeOf = (code: string): string | null => {
  const idx = (PUC_LEVELS as readonly number[]).indexOf(code.length);
  if (idx <= 0) return null;
  return code.slice(0, PUC_LEVELS[idx - 1]);
};

/** Toda la cadena de ancestros, de la clase al padre inmediato. */
export const ancestorCodesOf = (code: string): string[] => {
  const out: string[] = [];
  for (const len of PUC_LEVELS) {
    if (len >= code.length) break;
    out.push(code.slice(0, len));
  }
  return out;
};

export const isDescendantOf = (code: string, ancestor: string): boolean =>
  code.length > ancestor.length && code.startsWith(ancestor);

/**
 * Saldo con el signo de la naturaleza de la cuenta.
 *
 * Un banco con 500 al débito tiene saldo +500; un proveedor con 500 al crédito
 * también tiene saldo +500, porque para él "tener saldo" significa deber. Sin
 * esta normalización, el balance mostraría todos los pasivos en negativo y
 * habría que explicárselo a cada persona que lo abriera.
 */
export const signedBalance = (
  nature: AccountNature,
  debit: Decimal.Value,
  credit: Decimal.Value,
): Decimal =>
  nature === 'DEBIT'
    ? new Decimal(debit).minus(credit)
    : new Decimal(credit).minus(debit);

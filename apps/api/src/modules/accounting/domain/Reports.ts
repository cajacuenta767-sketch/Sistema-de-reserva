import { Decimal } from '@erp/core';
import type { AccountNature, AccountType } from './Account.js';
import { signedBalance, statementFor } from './Account.js';

/**
 * Agregación de los informes contables.
 *
 * La suma la hace PostgreSQL —millones de líneas no pasan por Node—, pero el
 * ARMADO del árbol y el cálculo de los subtotales viven aquí, porque es donde
 * se decide si el balance cuadra y eso hay que poder probarlo sin base de
 * datos.
 */

export interface LedgerRow {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  nature: AccountNature;
  /** Saldo al inicio del rango, con el signo de la naturaleza. */
  openingBalance: string;
  debit: string;
  credit: string;
}

export interface TrialBalanceNode extends LedgerRow {
  level: number;
  isPostable: boolean;
  closingBalance: string;
  children: TrialBalanceNode[];
}

const sum = (values: readonly string[]): Decimal =>
  values.reduce((a, v) => a.plus(new Decimal(v)), new Decimal(0));

const parentCode = (code: string, levels: readonly number[]): string | null => {
  const idx = levels.indexOf(code.length);
  return idx <= 0 ? null : code.slice(0, levels[idx - 1]);
};

/**
 * Arma el árbol del balance de prueba desde las hojas.
 *
 * Las cuentas de agrupación NO se consultan: se calculan sumando sus hijas. Si
 * se leyeran de la base, un movimiento mal puesto en una cuenta de agrupación
 * se contaría dos veces, y el balance seguiría cuadrando —porque el error está
 * en las dos columnas— mostrando el doble del saldo real.
 */
export const buildTrialBalance = (
  leaves: readonly LedgerRow[],
  levels: readonly number[] = [1, 2, 4, 6, 8],
): TrialBalanceNode[] => {
  const byCode = new Map<string, TrialBalanceNode>();

  const ensure = (code: string, seed?: LedgerRow): TrialBalanceNode => {
    const existing = byCode.get(code);
    if (existing) return existing;
    const node: TrialBalanceNode = {
      accountId: seed?.accountId ?? '',
      code,
      name: seed?.name ?? code,
      type: seed?.type ?? 'ASSET',
      nature: seed?.nature ?? 'DEBIT',
      level: code.length,
      isPostable: seed !== undefined,
      openingBalance: '0',
      debit: '0',
      credit: '0',
      closingBalance: '0',
      children: [],
    };
    byCode.set(code, node);
    return node;
  };

  for (const leaf of leaves) ensure(leaf.code, leaf);

  // Los ancestros existen aunque no tengan hoja propia en el resultado.
  for (const leaf of leaves) {
    for (const len of levels) {
      if (len >= leaf.code.length) break;
      ensure(leaf.code.slice(0, len));
    }
  }

  for (const node of byCode.values()) {
    const parent = parentCode(node.code, levels);
    if (parent) byCode.get(parent)?.children.push(node);
  }

  const rollUp = (node: TrialBalanceNode): void => {
    node.children.sort((a, b) => a.code.localeCompare(b.code));
    for (const child of node.children) rollUp(child);

    if (node.isPostable) {
      const leaf = leaves.find((l) => l.code === node.code);
      if (leaf) {
        node.openingBalance = leaf.openingBalance;
        node.debit = leaf.debit;
        node.credit = leaf.credit;
        node.type = leaf.type;
        node.nature = leaf.nature;
        node.name = leaf.name;
      }
    }
    if (node.children.length > 0) {
      node.openingBalance = sum([
        node.isPostable ? node.openingBalance : '0',
        ...node.children.map((c) => c.openingBalance),
      ]).toFixed(4);
      node.debit = sum([
        node.isPostable ? node.debit : '0',
        ...node.children.map((c) => c.debit),
      ]).toFixed(4);
      node.credit = sum([
        node.isPostable ? node.credit : '0',
        ...node.children.map((c) => c.credit),
      ]).toFixed(4);
      const first = node.children[0];
      if (first && !node.isPostable) {
        node.type = first.type;
        node.nature = first.nature;
      }
    }

    node.closingBalance = new Decimal(node.openingBalance)
      .plus(signedBalance(node.nature, node.debit, node.credit))
      .toFixed(4);
  };

  const roots = [...byCode.values()].filter((n) => parentCode(n.code, levels) === null);
  for (const root of roots) rollUp(root);
  roots.sort((a, b) => a.code.localeCompare(b.code));
  return roots;
};

export interface TrialBalanceCheck {
  debit: string;
  credit: string;
  balanced: boolean;
}

/** La comprobación que da nombre al informe: las dos columnas suman igual. */
export const checkTrialBalance = (leaves: readonly LedgerRow[]): TrialBalanceCheck => {
  const debit = sum(leaves.map((l) => l.debit));
  const credit = sum(leaves.map((l) => l.credit));
  return { debit: debit.toFixed(4), credit: credit.toFixed(4), balanced: debit.equals(credit) };
};

export interface IncomeStatement {
  revenue: string;
  costs: string;
  expenses: string;
  grossProfit: string;
  netResult: string;
}

/**
 * Estado de resultados a partir de los saldos de las clases 4, 5, 6 y 7.
 *
 * Los ingresos entran con su naturaleza (crédito) y los costos y gastos con la
 * suya (débito), así que el resultado es una resta y no hay que acordarse de
 * ningún signo. Las devoluciones en ventas, que son un ingreso de naturaleza
 * débito, restan solas: por eso su naturaleza se guarda por cuenta y no se
 * deduce de la clase.
 */
export const incomeStatement = (leaves: readonly LedgerRow[]): IncomeStatement => {
  let revenue = new Decimal(0);
  let costs = new Decimal(0);
  let expenses = new Decimal(0);

  for (const row of leaves) {
    if (statementFor(row.type) !== 'RESULTS') continue;
    const signed = new Decimal(row.openingBalance).plus(
      signedBalance(row.nature, row.debit, row.credit),
    );
    // El signo se normaliza a la clase, no a la cuenta: una devolución en
    // ventas (ingreso de naturaleza débito) tiene que RESTAR del ingreso.
    const asClass = row.nature === (row.type === 'INCOME' ? 'CREDIT' : 'DEBIT')
      ? signed
      : signed.negated();

    if (row.type === 'INCOME') revenue = revenue.plus(asClass);
    else if (row.type === 'COST') costs = costs.plus(asClass);
    else expenses = expenses.plus(asClass);
  }

  const grossProfit = revenue.minus(costs);
  return {
    revenue: revenue.toFixed(4),
    costs: costs.toFixed(4),
    expenses: expenses.toFixed(4),
    grossProfit: grossProfit.toFixed(4),
    netResult: grossProfit.minus(expenses).toFixed(4),
  };
};

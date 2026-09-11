import { AppError, Decimal, type Clock, type LocalDate } from '@erp/core';
import type { Tx } from '../../../../platform/db/unitOfWork.js';
import type { RequestContext } from '../../../../platform/authz/RequestContext.js';
import { assertCan } from '../../../../platform/authz/scope.js';
import { statementFor } from '../../domain/Account.js';
import {
  buildTrialBalance,
  checkTrialBalance,
  incomeStatement,
  type IncomeStatement,
  type LedgerRow,
  type TrialBalanceNode,
} from '../../domain/Reports.js';
import type {
  LedgerEntryRow,
  LedgerQuery,
  ReportRepository,
} from '../ports/AccountingRepositories.js';

export interface ReportRange {
  from: LocalDate;
  to: LocalDate;
}

export interface TrialBalanceReport extends ReportRange {
  rows: TrialBalanceNode[];
  totals: { debit: string; credit: string; balanced: boolean };
}

export interface BalanceSheetReport extends ReportRange {
  assets: TrialBalanceNode[];
  liabilities: TrialBalanceNode[];
  equity: TrialBalanceNode[];
  totals: {
    assets: string;
    liabilities: string;
    equity: string;
    /** Resultado del periodo, que todavía no está en una cuenta de patrimonio. */
    result: string;
    /** Activo − (pasivo + patrimonio + resultado). Cero o hay un problema. */
    difference: string;
    balanced: boolean;
  };
}

export interface LedgerReport extends ReportRange {
  rows: Array<LedgerEntryRow & { runningBalance: string }>;
  opening: string;
  closing: string;
  truncated: boolean;
}

/** Tope del libro mayor en pantalla. Más que esto se exporta, no se lee. */
const LEDGER_LIMIT = 5000;

export class ReportUseCases {
  constructor(
    private readonly reports: ReportRepository,
    private readonly clock: Clock,
  ) {}

  private range(from?: string, to?: string): ReportRange {
    const today = this.clock.now().toISOString().slice(0, 10);
    const range = { from: from ?? `${today.slice(0, 4)}-01-01`, to: to ?? today };
    if (range.from > range.to) {
      throw AppError.validation(`El rango ${range.from} a ${range.to} está invertido`);
    }
    return range;
  }

  /**
   * Balance de prueba.
   *
   * Es el informe que da la señal de alarma: si las dos columnas no suman
   * igual, hay un problema en los datos y todo lo demás —el balance general,
   * el estado de resultados— está mal aunque parezca razonable. Por eso el
   * resultado incluye `balanced` y la pantalla lo muestra, en vez de presentar
   * unas cifras bonitas que no cuadran.
   */
  async trialBalance(
    ctx: RequestContext,
    tx: Tx,
    from?: string,
    to?: string,
    options: { includeZero?: boolean; costCenterId?: string | null } = {},
  ): Promise<TrialBalanceReport> {
    assertCan(ctx, 'accounting:report:read');
    const range = this.range(from, to);
    const leaves = await this.reports.balances(tx, {
      ...range,
      includeZero: options.includeZero ?? false,
      costCenterId: options.costCenterId ?? null,
    });
    const check = checkTrialBalance(leaves);
    return {
      ...range,
      rows: buildTrialBalance(leaves),
      totals: { debit: check.debit, credit: check.credit, balanced: check.balanced },
    };
  }

  async incomeStatement(
    ctx: RequestContext,
    tx: Tx,
    from?: string,
    to?: string,
    costCenterId?: string | null,
  ): Promise<IncomeStatement & ReportRange & { rows: TrialBalanceNode[] }> {
    assertCan(ctx, 'accounting:report:read');
    const range = this.range(from, to);
    const leaves = await this.reports.balances(tx, {
      ...range,
      costCenterId: costCenterId ?? null,
    });
    const results = leaves.filter((l) => statementFor(l.type) === 'RESULTS');
    return { ...range, ...incomeStatement(results), rows: buildTrialBalance(results) };
  }

  /**
   * Balance general.
   *
   * La ecuación contable se comprueba aquí y se devuelve: activo = pasivo +
   * patrimonio + resultado del periodo. El resultado va aparte porque hasta que
   * no se cierra el año no vive en ninguna cuenta de patrimonio, y sin sumarlo
   * el balance parecería descuadrado exactamente por la utilidad del ejercicio
   * —que es el descuadre que más veces se reporta como error y nunca lo es—.
   */
  async balanceSheet(
    ctx: RequestContext,
    tx: Tx,
    to?: string,
    from?: string,
  ): Promise<BalanceSheetReport> {
    assertCan(ctx, 'accounting:report:read');
    const range = this.range(from ?? '1900-01-01', to);
    const leaves = await this.reports.balances(tx, range);

    const pick = (prefix: string): LedgerRow[] => leaves.filter((l) => l.code.startsWith(prefix));
    const closing = (rows: readonly LedgerRow[]): Decimal =>
      rows.reduce(
        (acc, r) =>
          acc
            .plus(r.openingBalance)
            .plus(
              r.nature === 'DEBIT'
                ? new Decimal(r.debit).minus(r.credit)
                : new Decimal(r.credit).minus(r.debit),
            ),
        new Decimal(0),
      );

    const assets = pick('1');
    const liabilities = pick('2');
    const equity = pick('3');
    const results = leaves.filter((l) => statementFor(l.type) === 'RESULTS');
    const result = new Decimal(incomeStatement(results).netResult);

    const assetTotal = closing(assets);
    const liabilityTotal = closing(liabilities);
    const equityTotal = closing(equity);
    const difference = assetTotal.minus(liabilityTotal).minus(equityTotal).minus(result);

    return {
      ...range,
      assets: buildTrialBalance(assets),
      liabilities: buildTrialBalance(liabilities),
      equity: buildTrialBalance(equity),
      totals: {
        assets: assetTotal.toFixed(4),
        liabilities: liabilityTotal.toFixed(4),
        equity: equityTotal.toFixed(4),
        result: result.toFixed(4),
        difference: difference.toFixed(4),
        balanced: difference.isZero(),
      },
    };
  }

  /**
   * Libro mayor de una cuenta, con saldo corrido.
   *
   * El saldo corrido se calcula aquí y no en SQL con una ventana: la función de
   * ventana obligaría a que el orden de la consulta y el del informe fueran
   * idénticos para siempre, y basta cambiar el orden en pantalla para que los
   * saldos dejen de tener sentido sin que nada falle.
   */
  async ledger(
    ctx: RequestContext,
    tx: Tx,
    query: LedgerQuery,
  ): Promise<LedgerReport> {
    assertCan(ctx, 'accounting:report:read');
    const range = this.range(query.from, query.to);
    const full: LedgerQuery = { ...query, ...range };

    const balances = await this.reports.balances(tx, full);
    const opening = balances.reduce((acc, r) => acc.plus(r.openingBalance), new Decimal(0));

    const movements = await this.reports.movements(tx, full, LEDGER_LIMIT + 1);
    const truncated = movements.length > LEDGER_LIMIT;
    const shown = truncated ? movements.slice(0, LEDGER_LIMIT) : movements;

    // El signo del saldo corrido sigue la naturaleza de la cuenta consultada.
    // Sin cuenta concreta se usa débito − crédito, que es lo que significa el
    // saldo de un conjunto heterogéneo de cuentas.
    const nature = query.accountId ? (balances[0]?.nature ?? 'DEBIT') : 'DEBIT';
    let running = opening;
    const rows = shown.map((row) => {
      running =
        nature === 'DEBIT'
          ? running.plus(row.debit).minus(row.credit)
          : running.plus(row.credit).minus(row.debit);
      return { ...row, runningBalance: running.toFixed(4) };
    });

    return {
      ...range,
      rows,
      opening: opening.toFixed(4),
      closing: running.toFixed(4),
      truncated,
    };
  }

  /**
   * Auxiliar por tercero: cuánto debe cada cliente y cuánto se le debe a cada
   * proveedor, según la contabilidad y no según el módulo de ventas.
   *
   * Que las dos cifras coincidan es la comprobación que descubre los errores de
   * verdad: una cartera que no cuadra con la cuenta 1305 significa que algún
   * documento no se contabilizó, y sin este informe nadie se entera hasta que
   * el contador cierra el año.
   */
  async partySubledger(
    ctx: RequestContext,
    tx: Tx,
    from?: string,
    to?: string,
    accountId?: string | null,
  ): Promise<
    ReportRange & {
      rows: Array<{
        partyId: string;
        partyName: string;
        accountCode: string;
        debit: string;
        credit: string;
        balance: string;
      }>;
      total: string;
    }
  > {
    assertCan(ctx, 'accounting:report:read');
    const range = this.range(from ?? '1900-01-01', to);
    const rows = await this.reports.partyBalances(tx, {
      ...range,
      accountId: accountId ?? null,
    });

    let total = new Decimal(0);
    const withBalance = rows.map((r) => {
      const balance = new Decimal(r.debit).minus(r.credit);
      total = total.plus(balance);
      return { ...r, balance: balance.toFixed(4) };
    });
    return { ...range, rows: withBalance, total: total.toFixed(4) };
  }
}

import { AppError, Money, newId, type Clock, type LocalDate } from '@erp/core';
import type { Tx } from '../../../../platform/db/unitOfWork.js';
import { actorMembershipId, type RequestContext } from '../../../../platform/authz/RequestContext.js';
import type { SequenceAllocator } from '../../../../platform/numbering/SequenceAllocator.js';
import type { Logger } from '../../../../platform/logging/logger.js';
import {
  ENTRY_DECIMALS,
  assertBalanced,
  convertToBase,
  entryTotals,
  roundingTolerance,
  swapSides,
  type EntryDraft,
  type EntryLineDraft,
} from '../../domain/JournalEntry.js';
import { accountRole, type AccountRole } from '../../domain/AccountRoles.js';
import { assertPeriodOpen } from '../../domain/Periods.js';
import type {
  AccountRepository,
  EntryRecord,
  EntryRepository,
  JournalRepository,
  MappingRepository,
  NewEntryLine,
  PeriodRepository,
} from '../ports/AccountingRepositories.js';

/**
 * El servicio que escribe asientos.
 *
 * Toma el borrador PURO que produjo el motor —roles e importes, sin una sola
 * cuenta concreta— y lo aterriza: resuelve los roles contra el plan de cuentas
 * de la empresa, busca el periodo y el diario, convierte a la moneda funcional,
 * asigna el consecutivo y contabiliza. Todo dentro de la transacción de quien lo
 * llamó, que es lo que garantiza el invariante: si la factura se guarda, su
 * asiento existe; si el asiento falla, la factura no se emite.
 */

export interface PostOptions {
  /** Moneda funcional de la empresa. */
  baseCurrency: string;
  /** Documento que origina el asiento, para el drill-down. `null` si es manual. */
  sourceId: string | null;
  actorMembershipId?: string | null;
}

export class PostingService {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly mappings: MappingRepository,
    private readonly journals: JournalRepository,
    private readonly periods: PeriodRepository,
    private readonly entries: EntryRepository,
    private readonly sequences: SequenceAllocator,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  /**
   * Resuelve los roles del borrador a cuentas concretas.
   *
   * Una consulta para todos los roles del asiento, no una por línea. Un asiento
   * de nómina tiene veinte líneas y veinte viajes a la base por asiento
   * convierten una liquidación de cien empleados en dos mil consultas.
   */
  private async resolveAccounts(
    tx: Tx,
    lines: readonly EntryLineDraft[],
  ): Promise<Map<AccountRole, string>> {
    const roles = [...new Set(lines.map((l) => l.role).filter((r): r is AccountRole => !!r))];
    if (roles.length === 0) return new Map();

    const configured = await this.mappings.all(tx);
    const resolved = new Map<AccountRole, string>();
    const missing: string[] = [];

    for (const role of roles) {
      const accountId = configured.get(role);
      if (accountId) resolved.set(role, accountId);
      else missing.push(`${accountRole(role).label} (${accountRole(role).usedFor})`);
    }

    if (missing.length > 0) {
      throw AppError.rule(
        'Faltan cuentas contables por configurar antes de poder contabilizar: ' +
          missing.join('; ') +
          '. Configúralas en Contabilidad → Cuentas por operación.',
        { missingRoles: missing },
      );
    }
    return resolved;
  }

  /**
   * Contabiliza un borrador.
   *
   * Devuelve el asiento ya contabilizado. Si algo falla —periodo cerrado,
   * cuenta sin configurar, descuadre— lanza, y como todo corre dentro de la
   * transacción del documento, el documento tampoco se guarda.
   */
  async post(
    tx: Tx,
    ctx: RequestContext,
    draft: EntryDraft,
    options: PostOptions,
  ): Promise<EntryRecord> {
    assertBalanced(draft);

    const period = await this.periods.containing(tx, draft.date);
    if (!period) {
      throw AppError.rule(
        `No hay un periodo contable que contenga el ${draft.date}. ` +
          'Abre el año fiscal correspondiente en Contabilidad → Periodos.',
      );
    }
    assertPeriodOpen(period);

    const journal = await this.journals.byType(tx, draft.journalType);
    if (!journal) {
      throw AppError.rule(
        `No hay un diario activo de tipo "${draft.journalType}". ` +
          'Créalo en Contabilidad → Diarios.',
      );
    }

    const byRole = await this.resolveAccounts(tx, draft.lines);
    const { lines, rounding } = convertToBase(draft, options.baseCurrency);

    const entryId = newId();
    const newLines: NewEntryLine[] = lines.map((line) => {
      const accountId = line.accountId ?? (line.role ? byRole.get(line.role) : undefined);
      if (!accountId) {
        throw AppError.rule(`La línea "${line.description}" no tiene cuenta contable asignada`);
      }
      return {
        accountId,
        debit: line.debit,
        credit: line.credit,
        baseDebit: line.baseDebit,
        baseCredit: line.baseCredit,
        description: line.description,
        partyId: line.partyId ?? null,
        costCenterId: line.costCenterId ?? null,
        branchId: line.branchId ?? null,
        reference: line.reference ?? null,
      };
    });

    /*
     * El residuo del redondeo, cuando lo hay.
     *
     * Solo aparece al convertir de otra moneda, y solo puede ser de centavos.
     * Se tolera hasta un peso por línea: por encima de eso no es redondeo sino
     * un error de cálculo, y añadir un ajuste lo convertiría en una cifra
     * plausible que nadie volvería a mirar.
     */
    if (!rounding.isZero()) {
      const tolerance = roundingTolerance(lines.length, options.baseCurrency);
      if (rounding.abs().greaterThan(tolerance)) {
        throw AppError.rule(
          `La conversión a ${options.baseCurrency} descuadra el asiento por ` +
            `${rounding.abs().toDb(ENTRY_DECIMALS)}, muy por encima del redondeo esperado. ` +
            'Revisa la tasa de cambio del documento.',
          { difference: rounding.toDb(ENTRY_DECIMALS) },
        );
      }
      const roundingAccount = byRole.get('ROUNDING') ?? (await this.roundingAccount(tx));
      const amount = rounding.abs();
      // El residuo entra por el lado que falta: si sobran débitos, va al crédito.
      newLines.push({
        accountId: roundingAccount,
        debit: rounding.isPositive() ? '0' : amount.toDb(ENTRY_DECIMALS),
        credit: rounding.isPositive() ? amount.toDb(ENTRY_DECIMALS) : '0',
        baseDebit: rounding.isPositive() ? '0' : amount.toDb(ENTRY_DECIMALS),
        baseCredit: rounding.isPositive() ? amount.toDb(ENTRY_DECIMALS) : '0',
        description: `Ajuste al peso por conversión de ${draft.currency}`,
        partyId: null,
        costCenterId: null,
        branchId: null,
        reference: null,
      });
    }

    await this.entries.createDraft(
      tx,
      {
        id: entryId,
        organizationId: ctx.organizationId,
        journalId: journal.id,
        periodId: period.id,
        number: null,
        entryDate: draft.date,
        status: 'DRAFT',
        memo: draft.memo,
        currencyCode: draft.currency,
        exchangeRate: draft.exchangeRate,
        debitTotal: '0',
        creditTotal: '0',
        sourceType: draft.sourceType,
        sourceId: options.sourceId,
        reversalOfId: null,
        reversedById: null,
        postedAt: null,
      },
      newLines,
    );

    return this.finishPosting(
      tx,
      ctx,
      entryId,
      journal.sequencePrefix,
      draft.date,
      draft.currency,
      newLines,
    );
  }

  /** Asigna el consecutivo y marca el asiento como contabilizado. */
  private async finishPosting(
    tx: Tx,
    ctx: RequestContext,
    entryId: string,
    prefix: string,
    date: LocalDate,
    currency: string,
    lines: readonly NewEntryLine[],
  ): Promise<EntryRecord> {
    const allocated = await this.sequences.next(
      tx,
      { organizationId: ctx.organizationId, docType: 'journal_entry', prefix },
      new Date(`${date}T00:00:00Z`),
    );

    // Los totales de la cabecera van en la moneda del ASIENTO: es lo que el
    // disparador diferido compara contra `debit`/`credit` de las líneas.
    let debit = Money.zero(currency);
    let credit = Money.zero(currency);
    for (const line of lines) {
      debit = debit.plus(Money.fromDb(line.debit, currency));
      credit = credit.plus(Money.fromDb(line.credit, currency));
    }

    await this.entries.post(
      tx,
      entryId,
      allocated.formatted,
      this.clock.now(),
      actorMembershipId(ctx),
      debit.toDb(ENTRY_DECIMALS),
      credit.toDb(ENTRY_DECIMALS),
    );

    const saved = await this.entries.byId(tx, entryId);
    if (!saved) throw AppError.internal('El asiento no se pudo guardar');
    return saved;
  }

  private async roundingAccount(tx: Tx): Promise<string> {
    const account = await this.accounts.byCode(tx, accountRole('ROUNDING').defaultCode);
    if (!account) {
      throw AppError.rule(
        'No hay cuenta de ajuste al peso configurada y la conversión deja un residuo de centavos',
      );
    }
    return account.id;
  }

  /**
   * Reversa un asiento: crea otro con los lados cambiados.
   *
   * El original NO se toca: sigue ahí, con su número y sus líneas, y queda
   * marcado como reversado. Es la diferencia entre una contabilidad que se
   * puede auditar y una que solo dice lo que dice hoy.
   *
   * La reversión se fecha en `date`, no en la del original: reversar en
   * noviembre un asiento de enero con fecha de enero cambiaría un mes ya
   * declarado —y si enero está cerrado, ni siquiera se podría—.
   */
  async reverse(
    tx: Tx,
    ctx: RequestContext,
    original: EntryRecord,
    date: LocalDate,
    reason: string,
  ): Promise<EntryRecord> {
    if (original.status !== 'POSTED') {
      throw AppError.rule('Solo se reversan asientos contabilizados; un borrador se descarta');
    }
    if (original.reversedById) {
      throw AppError.rule(`El asiento ${original.number} ya fue reversado`);
    }

    const period = await this.periods.containing(tx, date);
    if (!period) throw AppError.rule(`No hay un periodo contable que contenga el ${date}`);
    assertPeriodOpen(period);

    const lines = await this.entries.linesOf(tx, original.id);
    const reversalId = newId();
    const reversedLines: NewEntryLine[] = lines.map((l) =>
      swapSides({
        accountId: l.accountId,
        debit: l.debit,
        credit: l.credit,
        baseDebit: l.baseDebit,
        baseCredit: l.baseCredit,
        description: l.description,
        partyId: l.partyId,
        costCenterId: l.costCenterId,
        branchId: l.branchId,
        reference: l.reference,
      }),
    );

    const journal = await this.journals.byId(tx, original.journalId);
    if (!journal) throw AppError.internal('El diario del asiento original ya no existe');

    await this.entries.createDraft(
      tx,
      {
        id: reversalId,
        organizationId: ctx.organizationId,
        journalId: original.journalId,
        periodId: period.id,
        number: null,
        entryDate: date,
        status: 'DRAFT',
        memo: `Reversión de ${original.number} · ${reason}`,
        currencyCode: original.currencyCode,
        exchangeRate: original.exchangeRate,
        debitTotal: '0',
        creditTotal: '0',
        sourceType: original.sourceType,
        sourceId: original.sourceId,
        reversalOfId: original.id,
        reversedById: null,
        postedAt: null,
      },
      reversedLines,
    );

    const reversal = await this.finishPosting(
      tx,
      ctx,
      reversalId,
      journal.sequencePrefix,
      date,
      original.currencyCode,
      reversedLines,
    );
    await this.entries.markReversed(tx, original.id, reversalId);
    this.logger.info(
      { original: original.number, reversal: reversal.number },
      'asiento reversado',
    );
    return reversal;
  }

  /** Suma de control, para los tests de invariante y el panel de diagnóstico. */
  totalsOf(draft: EntryDraft): { debit: string; credit: string } {
    const totals = entryTotals(draft.lines, draft.currency);
    return {
      debit: totals.debit.toDb(ENTRY_DECIMALS),
      credit: totals.credit.toDb(ENTRY_DECIMALS),
    };
  }
}

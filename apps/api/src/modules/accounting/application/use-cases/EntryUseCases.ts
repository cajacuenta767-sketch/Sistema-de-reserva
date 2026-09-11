import { AppError, Money, type Clock, type LocalDate } from '@erp/core';
import type { ListQuery } from '@erp/contracts';
import type { Tx } from '../../../../platform/db/unitOfWork.js';
import type { RequestContext } from '../../../../platform/authz/RequestContext.js';
import type { AuditRecorder } from '../../../../platform/audit/AuditRecorder.js';
import { assertCan } from '../../../../platform/authz/scope.js';
import type { ListResult } from '../../../../platform/http/list.js';
import {
  ENTRY_DECIMALS,
  type EntryDraft,
  type EntryLineDraft,
  type JournalType,
} from '../../domain/JournalEntry.js';
import type {
  AccountRepository,
  EntryLineRecord,
  EntryRecord,
  EntryRepository,
} from '../ports/AccountingRepositories.js';
import type { PostingService } from './PostingService.js';

export interface ManualEntryLineInput {
  accountId: string;
  debit?: string;
  credit?: string;
  description?: string;
  partyId?: string | null;
  costCenterId?: string | null;
  reference?: string | null;
}

export interface ManualEntryInput {
  date: LocalDate;
  memo: string;
  journalType?: JournalType;
  currencyCode?: string;
  exchangeRate?: string;
  lines: readonly ManualEntryLineInput[];
}

export interface EntryDetail {
  entry: EntryRecord;
  lines: EntryLineRecord[];
  /** Enlace al documento que lo originó, cuando lo hay. */
  source: { type: string; id: string; label: string; url: string } | null;
  reversal: { id: string; number: string | null } | null;
  reverses: { id: string; number: string | null } | null;
}

/** Dónde vive cada documento en la aplicación, para el drill-down. */
const SOURCE_ROUTES: Record<string, { label: string; path: string }> = {
  sales_invoice: { label: 'Factura de venta', path: '/facturas' },
  credit_note: { label: 'Nota de crédito', path: '/notas-credito' },
  payment: { label: 'Cobro', path: '/cobros' },
  purchase_bill: { label: 'Factura de compra', path: '/compras/facturas' },
  MANUAL: { label: 'Asiento manual', path: '' },
};

export class EntryUseCases {
  constructor(
    private readonly entries: EntryRepository,
    private readonly accounts: AccountRepository,
    private readonly posting: PostingService,
    private readonly audit: AuditRecorder,
    private readonly clock: Clock,
  ) {}

  async list(
    ctx: RequestContext,
    tx: Tx,
    query: ListQuery,
  ): Promise<ListResult<Record<string, unknown>>> {
    assertCan(ctx, 'accounting:entry:read');
    return this.entries.list(tx, query);
  }

  /**
   * Un asiento con todo lo que hace falta para explicarlo.
   *
   * Incluye el enlace al documento de origen: es la mitad del valor de tener
   * contabilidad automática. Un asiento que nadie puede rastrear hasta su
   * factura obliga a buscarla a mano por fecha e importe, y en un mes con
   * cuatrocientas facturas eso significa no hacerlo.
   */
  async get(ctx: RequestContext, tx: Tx, id: string): Promise<EntryDetail> {
    assertCan(ctx, 'accounting:entry:read');
    const entry = await this.entries.byId(tx, id);
    if (!entry) throw AppError.notFound('Asiento contable');

    const lines = await this.entries.linesOf(tx, id);
    const route = SOURCE_ROUTES[entry.sourceType];

    return {
      entry,
      lines,
      source:
        entry.sourceId && route && route.path
          ? {
              type: entry.sourceType,
              id: entry.sourceId,
              label: route.label,
              url: `${route.path}/${entry.sourceId}`,
            }
          : null,
      reversal: entry.reversedById ? await this.brief(tx, entry.reversedById) : null,
      reverses: entry.reversalOfId ? await this.brief(tx, entry.reversalOfId) : null,
    };
  }

  /** El asiento de un documento, para el botón "ver contabilización". */
  async forSource(
    ctx: RequestContext,
    tx: Tx,
    sourceType: string,
    sourceId: string,
  ): Promise<EntryDetail | null> {
    assertCan(ctx, 'accounting:entry:read');
    const entry = await this.entries.bySource(tx, sourceType, sourceId);
    return entry ? this.get(ctx, tx, entry.id) : null;
  }

  /**
   * Asiento manual.
   *
   * Se contabiliza de una vez: un borrador contable que nadie contabiliza es
   * una cifra que no está en el balance y que alguien cree que sí. Para lo que
   * no está listo existe el papel.
   */
  async createManual(ctx: RequestContext, tx: Tx, input: ManualEntryInput): Promise<EntryDetail> {
    assertCan(ctx, 'accounting:entry:create');

    const currency = (input.currencyCode ?? 'COP').toUpperCase();
    if (input.lines.length < 2) {
      throw AppError.validation('Un asiento mueve al menos dos cuentas');
    }

    const accountIds = [...new Set(input.lines.map((l) => l.accountId))];
    const lines: EntryLineDraft[] = [];

    for (const [index, line] of input.lines.entries()) {
      const debit = Money.fromDb(line.debit ?? '0', currency);
      const credit = Money.fromDb(line.credit ?? '0', currency);

      if (!debit.isZero() && !credit.isZero()) {
        throw AppError.validation(
          `La línea ${index + 1} tiene importe al débito y al crédito a la vez. ` +
            'Una línea mueve un solo lado; si hacen falta los dos, son dos líneas.',
        );
      }
      if (debit.isZero() && credit.isZero()) {
        throw AppError.validation(`La línea ${index + 1} no tiene importe`);
      }

      lines.push({
        accountId: line.accountId,
        side: debit.isZero() ? 'CREDIT' : 'DEBIT',
        amount: debit.isZero() ? credit : debit,
        description: line.description?.trim() || input.memo,
        partyId: line.partyId ?? null,
        costCenterId: line.costCenterId ?? null,
        reference: line.reference ?? null,
      });
    }

    // Todas las cuentas en UNA consulta: validarlas una a una serían tantos
    // viajes a la base como líneas tenga el asiento, y un asiento de nómina
    // tiene veinte.
    const accounts = await this.accounts.byIds(tx, accountIds);
    for (const accountId of accountIds) {
      const account = accounts.get(accountId);
      if (!account) throw AppError.validation(`La cuenta ${accountId} no existe`);
      if (!account.isPostable) {
        throw AppError.rule(
          `${account.code} (${account.name}) es de agrupación y no recibe movimiento`,
        );
      }
      if (!account.isActive) {
        throw AppError.rule(`${account.code} (${account.name}) está inactiva`);
      }
    }

    const draft: EntryDraft = {
      journalType: input.journalType ?? 'GENERAL',
      date: input.date,
      memo: input.memo.trim(),
      sourceType: 'MANUAL',
      sourceId: null,
      currency,
      exchangeRate: input.exchangeRate ?? '1',
      lines,
    };

    const entry = await this.posting.post(tx, ctx, draft, {
      baseCurrency: 'COP',
      // Un asiento manual no tiene documento detrás. El origen queda en NULL, y
      // así el índice que impide contabilizar dos veces el mismo documento no le
      // aplica: dos asientos manuales idénticos son legítimos.
      sourceId: null,
      actorMembershipId: ctx.membershipId,
    });

    await this.audit.record(tx, ctx, {
      action: 'CREATE',
      entityType: 'journal_entry',
      entityId: entry.id,
      entityLabel: `${entry.number} · ${entry.memo}`,
      after: {
        fecha: entry.entryDate,
        debitos: entry.debitTotal,
        creditos: entry.creditTotal,
        lineas: lines.length,
      },
    });

    return this.get(ctx, tx, entry.id);
  }

  /**
   * Reversa un asiento.
   *
   * La fecha por defecto es HOY, no la del original: reversar en noviembre un
   * asiento de enero con fecha de enero cambiaría un mes ya declarado. Quien
   * necesite reversar dentro del mismo periodo lo pide explícitamente.
   */
  async reverse(
    ctx: RequestContext,
    tx: Tx,
    id: string,
    reason: string,
    date?: LocalDate,
  ): Promise<EntryDetail> {
    assertCan(ctx, 'accounting:entry:reverse');
    const original = await this.entries.byId(tx, id);
    if (!original) throw AppError.notFound('Asiento contable');

    const motivo = reason.trim();
    if (!motivo) throw AppError.validation('Reversar un asiento exige un motivo');

    const reversal = await this.posting.reverse(
      tx,
      ctx,
      original,
      date ?? this.today(),
      motivo,
    );

    await this.audit.record(tx, ctx, {
      action: 'UPDATE',
      entityType: 'journal_entry',
      entityId: id,
      entityLabel: original.number ?? '',
      before: { estado: 'vigente' },
      after: { estado: 'reversado', por: reversal.number, motivo },
    });

    return this.get(ctx, tx, reversal.id);
  }

  /** Cifras de control del libro diario, para el panel y para los tests. */
  async totals(
    ctx: RequestContext,
    tx: Tx,
    query: ListQuery,
  ): Promise<{ debit: string; credit: string; balanced: boolean }> {
    assertCan(ctx, 'accounting:entry:read');
    const result = await this.entries.list(tx, { ...query, pageSize: 1, offset: 0 });
    const debit = Money.fromDb(String(result.aggregates?.debit_sum ?? '0'), 'COP');
    const credit = Money.fromDb(String(result.aggregates?.credit_sum ?? '0'), 'COP');
    return {
      debit: debit.toDb(ENTRY_DECIMALS),
      credit: credit.toDb(ENTRY_DECIMALS),
      balanced: debit.equals(credit),
    };
  }

  private async brief(tx: Tx, id: string): Promise<{ id: string; number: string | null } | null> {
    const entry = await this.entries.byId(tx, id);
    return entry ? { id: entry.id, number: entry.number } : null;
  }

  private today(): LocalDate {
    return this.clock.now().toISOString().slice(0, 10);
  }
}

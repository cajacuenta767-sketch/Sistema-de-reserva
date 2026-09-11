import type { ListQuery } from '@erp/contracts';
import type { LocalDate } from '@erp/core';
import type { Tx } from '../../../../platform/db/unitOfWork.js';
import type { ListResult } from '../../../../platform/http/list.js';
import type { AccountNature, AccountType } from '../../domain/Account.js';
import type { PeriodLike, PeriodStatus } from '../../domain/Periods.js';
import type { LedgerRow } from '../../domain/Reports.js';
import type { JournalType } from '../../domain/JournalEntry.js';

export interface AccountRecord {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  parentId: string | null;
  level: number;
  type: AccountType;
  nature: AccountNature;
  isPostable: boolean;
  isActive: boolean;
  requiresParty: boolean;
  requiresCostCenter: boolean;
  isCash: boolean;
  description: string | null;
}

export interface AccountRepository {
  list(tx: Tx, query: ListQuery): Promise<ListResult<Record<string, unknown>>>;
  tree(tx: Tx, onlyActive: boolean): Promise<AccountRecord[]>;
  byId(tx: Tx, id: string): Promise<AccountRecord | null>;
  byCode(tx: Tx, code: string): Promise<AccountRecord | null>;
  byCodes(tx: Tx, codes: readonly string[]): Promise<Map<string, AccountRecord>>;
  byIds(tx: Tx, ids: readonly string[]): Promise<Map<string, AccountRecord>>;
  create(tx: Tx, account: AccountRecord): Promise<void>;
  update(tx: Tx, account: AccountRecord): Promise<void>;
  softDelete(tx: Tx, id: string): Promise<void>;
  hasMovements(tx: Tx, id: string): Promise<boolean>;
  hasChildren(tx: Tx, id: string): Promise<boolean>;
  /** Inserta el PUC completo. Idempotente: no pisa lo que la empresa cambió. */
  seed(
    tx: Tx,
    organizationId: string,
    accounts: readonly Omit<AccountRecord, 'id' | 'organizationId' | 'parentId'>[],
  ): Promise<number>;
}

export interface MappingRepository {
  all(tx: Tx): Promise<Map<string, string>>;
  set(tx: Tx, organizationId: string, role: string, accountId: string): Promise<void>;
  seedDefaults(tx: Tx, organizationId: string): Promise<number>;
}

export interface FiscalYearRecord {
  id: string;
  organizationId: string;
  name: string;
  startDate: LocalDate;
  endDate: LocalDate;
  status: PeriodStatus;
  closedAt: string | null;
}

export interface FiscalYearRepository {
  list(tx: Tx): Promise<FiscalYearRecord[]>;
  byId(tx: Tx, id: string): Promise<FiscalYearRecord | null>;
  containing(tx: Tx, date: LocalDate): Promise<FiscalYearRecord | null>;
  create(tx: Tx, year: FiscalYearRecord): Promise<void>;
  setStatus(tx: Tx, id: string, status: PeriodStatus, closedBy: string | null): Promise<void>;
}

export interface PeriodRecord extends PeriodLike {
  organizationId: string;
  fiscalYearId: string;
  closedAt: string | null;
}

export interface PeriodRepository {
  ofYear(tx: Tx, fiscalYearId: string): Promise<PeriodRecord[]>;
  byId(tx: Tx, id: string): Promise<PeriodRecord | null>;
  containing(tx: Tx, date: LocalDate): Promise<PeriodRecord | null>;
  createMany(tx: Tx, periods: readonly PeriodRecord[]): Promise<void>;
  setStatus(tx: Tx, id: string, status: PeriodStatus, closedBy: string | null): Promise<void>;
  /** Un periodo con asientos no puede borrarse, solo cerrarse. */
  entryCount(tx: Tx, id: string): Promise<number>;
}

export interface JournalRecord {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  type: JournalType;
  sequencePrefix: string;
  isActive: boolean;
}

export interface JournalRepository {
  all(tx: Tx): Promise<JournalRecord[]>;
  byId(tx: Tx, id: string): Promise<JournalRecord | null>;
  byType(tx: Tx, type: JournalType): Promise<JournalRecord | null>;
  create(tx: Tx, journal: JournalRecord): Promise<void>;
  update(tx: Tx, journal: JournalRecord): Promise<void>;
}

export interface EntryLineRecord {
  id: string;
  entryId: string;
  position: number;
  accountId: string;
  accountCode: string;
  accountName: string;
  partyId: string | null;
  partyName: string | null;
  costCenterId: string | null;
  branchId: string | null;
  description: string;
  debit: string;
  credit: string;
  baseDebit: string;
  baseCredit: string;
  reference: string | null;
}

export interface EntryRecord {
  id: string;
  organizationId: string;
  journalId: string;
  journalCode: string;
  journalName: string;
  periodId: string;
  periodName: string;
  number: string | null;
  entryDate: LocalDate;
  status: 'DRAFT' | 'POSTED';
  memo: string;
  currencyCode: string;
  exchangeRate: string;
  debitTotal: string;
  creditTotal: string;
  sourceType: string;
  sourceId: string | null;
  reversalOfId: string | null;
  reversedById: string | null;
  postedAt: string | null;
}

/**
 * Línea lista para escribir.
 *
 * No lleva `side`: el lado ES qué columna trae importe, y la base lo impone con
 * un CHECK. Guardarlo aparte sería un segundo sitio donde dice lo mismo, y el
 * día que los dos discreparan ganaría el que mirase cada consulta.
 */
export interface NewEntryLine {
  accountId: string;
  debit: string;
  credit: string;
  baseDebit: string;
  baseCredit: string;
  description: string;
  partyId: string | null;
  costCenterId: string | null;
  branchId: string | null;
  reference: string | null;
}

export interface EntryRepository {
  list(tx: Tx, query: ListQuery): Promise<ListResult<Record<string, unknown>>>;
  byId(tx: Tx, id: string): Promise<EntryRecord | null>;
  linesOf(tx: Tx, entryId: string): Promise<EntryLineRecord[]>;
  /** El asiento vigente de un documento, para el enlace desde la factura. */
  bySource(tx: Tx, sourceType: string, sourceId: string): Promise<EntryRecord | null>;
  createDraft(
    tx: Tx,
    entry: Omit<EntryRecord, 'journalCode' | 'journalName' | 'periodName'>,
    lines: readonly NewEntryLine[],
  ): Promise<void>;
  post(
    tx: Tx,
    id: string,
    number: string,
    postedAt: Date,
    postedBy: string | null,
    debitTotal: string,
    creditTotal: string,
  ): Promise<void>;
  markReversed(tx: Tx, id: string, reversalId: string): Promise<void>;
  deleteDraft(tx: Tx, id: string): Promise<void>;
}

export interface LedgerQuery {
  from: LocalDate;
  to: LocalDate;
  accountId?: string | null;
  partyId?: string | null;
  costCenterId?: string | null;
  /** Incluye cuentas sin movimiento en el rango pero con saldo de apertura. */
  includeZero?: boolean;
}

export interface LedgerEntryRow {
  entryId: string;
  number: string | null;
  entryDate: LocalDate;
  journalCode: string;
  memo: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  partyId: string | null;
  partyName: string | null;
  description: string;
  debit: string;
  credit: string;
  sourceType: string;
  sourceId: string | null;
}

export interface ReportRepository {
  /** Saldos por cuenta imputable: apertura antes de `from`, movimiento dentro. */
  balances(tx: Tx, query: LedgerQuery): Promise<LedgerRow[]>;
  /** Movimientos detallados, para el libro mayor y el auxiliar por tercero. */
  movements(tx: Tx, query: LedgerQuery, limit: number): Promise<LedgerEntryRow[]>;
  /** Saldo por tercero en las cuentas auxiliares. */
  partyBalances(
    tx: Tx,
    query: LedgerQuery,
  ): Promise<
    { partyId: string; partyName: string; accountCode: string; debit: string; credit: string }[]
  >;
}

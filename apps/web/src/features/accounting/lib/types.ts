export type AccountType =
  | 'ASSET'
  | 'LIABILITY'
  | 'EQUITY'
  | 'INCOME'
  | 'EXPENSE'
  | 'COST'
  | 'MEMORANDUM';
export type AccountNature = 'DEBIT' | 'CREDIT';

export interface AccountRow {
  id: string;
  code: string;
  name: string;
  level: number;
  type: AccountType;
  nature: AccountNature;
  is_postable: boolean;
  is_active: boolean;
  requires_party: boolean;
  is_cash: boolean;
  description: string | null;
  child_count: string;
}

export interface AccountNode {
  id: string;
  code: string;
  name: string;
  level: number;
  type: AccountType;
  nature: AccountNature;
  isPostable: boolean;
  isActive: boolean;
  requiresParty: boolean;
  isCash: boolean;
  description: string | null;
  children: AccountNode[];
}

export interface AccountRoleRow {
  role: string;
  label: string;
  usedFor: string;
  required: boolean;
  accountId: string | null;
  accountCode: string | null;
  accountName: string | null;
}

export interface JournalRow {
  id: string;
  code: string;
  name: string;
  type: string;
  sequencePrefix: string;
  isActive: boolean;
}

export interface EntryRow {
  id: string;
  number: string | null;
  entry_date: string;
  status: 'DRAFT' | 'POSTED';
  memo: string;
  journal_code: string;
  journal_name: string;
  period_name: string;
  currency_code: string;
  debit_total: string;
  credit_total: string;
  source_type: string;
  source_id: string | null;
  reversal_of_id: string | null;
  reversed_by_id: string | null;
  is_reversed: boolean;
}

export interface EntryLine {
  id: string;
  position: number;
  accountId: string;
  accountCode: string;
  accountName: string;
  partyId: string | null;
  partyName: string | null;
  description: string;
  debit: string;
  credit: string;
  baseDebit: string;
  baseCredit: string;
  reference: string | null;
}

export interface EntryDetail {
  entry: {
    id: string;
    number: string | null;
    entryDate: string;
    status: 'DRAFT' | 'POSTED';
    memo: string;
    journalCode: string;
    journalName: string;
    periodName: string;
    currencyCode: string;
    debitTotal: string;
    creditTotal: string;
    sourceType: string;
    sourceId: string | null;
    reversalOfId: string | null;
    reversedById: string | null;
    postedAt: string | null;
  };
  lines: EntryLine[];
  source: { type: string; id: string; label: string; url: string } | null;
  reversal: { id: string; number: string | null } | null;
  reverses: { id: string; number: string | null } | null;
}

export interface PeriodRow {
  id: string;
  periodNo: number;
  name: string;
  startDate: string;
  endDate: string;
  status: 'OPEN' | 'CLOSED';
  closedAt: string | null;
}

export interface FiscalYear {
  year: {
    id: string;
    name: string;
    startDate: string;
    endDate: string;
    status: 'OPEN' | 'CLOSED';
    closedAt: string | null;
  };
  periods: PeriodRow[];
}

export interface BalanceNode {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  nature: AccountNature;
  level: number;
  isPostable: boolean;
  openingBalance: string;
  debit: string;
  credit: string;
  closingBalance: string;
  children: BalanceNode[];
}

export interface TrialBalance {
  from: string;
  to: string;
  rows: BalanceNode[];
  totals: { debit: string; credit: string; balanced: boolean };
}

export interface IncomeStatement {
  from: string;
  to: string;
  revenue: string;
  costs: string;
  expenses: string;
  grossProfit: string;
  netResult: string;
  rows: BalanceNode[];
}

export interface BalanceSheet {
  from: string;
  to: string;
  assets: BalanceNode[];
  liabilities: BalanceNode[];
  equity: BalanceNode[];
  totals: {
    assets: string;
    liabilities: string;
    equity: string;
    result: string;
    difference: string;
    balanced: boolean;
  };
}

export interface LedgerMovement {
  entryId: string;
  number: string | null;
  entryDate: string;
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
  runningBalance: string;
}

export interface Ledger {
  from: string;
  to: string;
  rows: LedgerMovement[];
  opening: string;
  closing: string;
  truncated: boolean;
}

export interface PartySubledger {
  from: string;
  to: string;
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

import type { ListQuery } from '@erp/contracts';
import type { Tx } from '../../../../platform/db/unitOfWork.js';
import { runList, type ListResult, type ListSpec } from '../../../../platform/http/list.js';
import type { AccountNature, AccountType } from '../../domain/Account.js';
import type { LedgerRow } from '../../domain/Reports.js';
import type {
  EntryLineRecord,
  EntryRecord,
  EntryRepository,
  LedgerEntryRow,
  LedgerQuery,
  NewEntryLine,
  ReportRepository,
} from '../../application/ports/AccountingRepositories.js';

interface EntryDbRow {
  id: string;
  organization_id: string;
  journal_id: string;
  journal_code: string;
  journal_name: string;
  period_id: string;
  period_name: string;
  number: string | null;
  entry_date: string;
  status: string;
  memo: string;
  currency_code: string;
  exchange_rate: string;
  debit_total: string;
  credit_total: string;
  source_type: string;
  source_id: string | null;
  reversal_of_id: string | null;
  reversed_by_id: string | null;
  posted_at: Date | null;
}

const ENTRY_COLUMNS = `
  e.id, e.organization_id, e.journal_id, j.code AS journal_code, j.name AS journal_name,
  e.period_id, p.name AS period_name, e.number, e.entry_date::text AS entry_date, e.status, e.memo,
  e.currency_code, trim_scale(e.exchange_rate)::text AS exchange_rate,
  e.debit_total::text AS debit_total, e.credit_total::text AS credit_total,
  e.source_type, e.source_id, e.reversal_of_id, e.reversed_by_id, e.posted_at`;

const ENTRY_FROM = `
  FROM journal_entries e
  JOIN journals j ON j.id = e.journal_id
  JOIN accounting_periods p ON p.id = e.period_id`;

const entryFrom = (r: EntryDbRow): EntryRecord => ({
  id: r.id,
  organizationId: r.organization_id,
  journalId: r.journal_id,
  journalCode: r.journal_code,
  journalName: r.journal_name,
  periodId: r.period_id,
  periodName: r.period_name,
  number: r.number,
  entryDate: r.entry_date,
  status: r.status as 'DRAFT' | 'POSTED',
  memo: r.memo,
  currencyCode: r.currency_code,
  exchangeRate: r.exchange_rate,
  debitTotal: r.debit_total,
  creditTotal: r.credit_total,
  sourceType: r.source_type,
  sourceId: r.source_id,
  reversalOfId: r.reversal_of_id,
  reversedById: r.reversed_by_id,
  postedAt: r.posted_at ? r.posted_at.toISOString() : null,
});

export class PgEntryRepository implements EntryRepository {
  private spec(): ListSpec {
    return {
      from: ENTRY_FROM,
      select: `
        e.id, e.number, e.entry_date::text AS entry_date, e.status, e.memo,
        j.code AS journal_code, j.name AS journal_name, p.name AS period_name,
        e.currency_code, e.debit_total::text AS debit_total, e.credit_total::text AS credit_total,
        e.source_type, e.source_id, e.reversal_of_id, e.reversed_by_id,
        (e.reversed_by_id IS NOT NULL) AS is_reversed`,
      fields: {
        number: { column: 'e.number', type: 'text', sortable: true, filterable: true, searchable: true },
        memo: { column: 'e.memo', type: 'text', sortable: true, filterable: true, searchable: true },
        entry_date: { column: 'e.entry_date', type: 'date', sortable: true, filterable: true },
        status: { column: 'e.status', type: 'text', sortable: true, filterable: true },
        journal_id: { column: 'e.journal_id', type: 'uuid', filterable: true },
        journal_code: { column: 'j.code', type: 'text', sortable: true, filterable: true, searchable: true },
        period_id: { column: 'e.period_id', type: 'uuid', filterable: true },
        source_type: { column: 'e.source_type', type: 'text', filterable: true },
        source_id: { column: 'e.source_id', type: 'uuid', filterable: true },
        debit_total: { column: 'e.debit_total', type: 'number', sortable: true, filterable: true },
      },
      // El libro diario se lee del más reciente al más antiguo, y dentro del
      // mismo día por número: dos asientos de la misma fecha tienen un orden y
      // es el de emisión.
      defaultSort: [
        { field: 'entry_date', dir: 'desc' },
        { field: 'number', dir: 'desc' },
      ],
      aggregates: {
        debit_sum: 'COALESCE(SUM(e.debit_total), 0)::text',
        credit_sum: 'COALESCE(SUM(e.credit_total), 0)::text',
        drafts: "COUNT(*) FILTER (WHERE e.status = 'DRAFT')::int",
      },
      countExpression: 'e.id',
    };
  }

  async list(tx: Tx, query: ListQuery): Promise<ListResult<Record<string, unknown>>> {
    return runList(tx, this.spec(), query);
  }

  async byId(tx: Tx, id: string): Promise<EntryRecord | null> {
    const { rows } = await tx.client.query<EntryDbRow>(
      `SELECT ${ENTRY_COLUMNS} ${ENTRY_FROM} WHERE e.id = $1`,
      [id],
    );
    return rows[0] ? entryFrom(rows[0]) : null;
  }

  async bySource(tx: Tx, sourceType: string, sourceId: string): Promise<EntryRecord | null> {
    const { rows } = await tx.client.query<EntryDbRow>(
      `SELECT ${ENTRY_COLUMNS} ${ENTRY_FROM}
        WHERE e.source_type = $1 AND e.source_id = $2 AND e.reversal_of_id IS NULL
        ORDER BY e.created_at DESC LIMIT 1`,
      [sourceType, sourceId],
    );
    return rows[0] ? entryFrom(rows[0]) : null;
  }

  async linesOf(tx: Tx, entryId: string): Promise<EntryLineRecord[]> {
    const { rows } = await tx.client.query<{
      id: string;
      entry_id: string;
      position: number;
      account_id: string;
      account_code: string;
      account_name: string;
      party_id: string | null;
      party_name: string | null;
      cost_center_id: string | null;
      branch_id: string | null;
      description: string;
      debit: string;
      credit: string;
      base_debit: string;
      base_credit: string;
      reference: string | null;
    }>(
      `SELECT l.id, l.entry_id, l.position, l.account_id, a.code AS account_code, a.name AS account_name,
              l.party_id, pa.display_name AS party_name, l.cost_center_id, l.branch_id, l.description,
              l.debit::text AS debit, l.credit::text AS credit,
              l.base_debit::text AS base_debit, l.base_credit::text AS base_credit, l.reference
         FROM journal_lines l
         JOIN accounts a ON a.id = l.account_id
         LEFT JOIN parties pa ON pa.id = l.party_id
        WHERE l.entry_id = $1
        ORDER BY l.position`,
      [entryId],
    );
    return rows.map((r) => ({
      id: r.id,
      entryId: r.entry_id,
      position: r.position,
      accountId: r.account_id,
      accountCode: r.account_code,
      accountName: r.account_name,
      partyId: r.party_id,
      partyName: r.party_name,
      costCenterId: r.cost_center_id,
      branchId: r.branch_id,
      description: r.description,
      debit: r.debit,
      credit: r.credit,
      baseDebit: r.base_debit,
      baseCredit: r.base_credit,
      reference: r.reference,
    }));
  }

  /**
   * Crea el asiento en BORRADOR con todas sus líneas.
   *
   * El orden no es opcional: la base impide escribir líneas en un asiento ya
   * contabilizado, así que primero nace el borrador, luego se llena y solo al
   * final se contabiliza. Esa secuencia es lo que hace que la comprobación de
   * cuadre tenga sentido —un asiento a medio escribir está descuadrado por
   * definición— y lo que impide que nadie añada una línea después.
   */
  async createDraft(
    tx: Tx,
    entry: Omit<EntryRecord, 'journalCode' | 'journalName' | 'periodName'>,
    lines: readonly NewEntryLine[],
  ): Promise<void> {
    await tx.client.query(
      `INSERT INTO journal_entries
         (id, organization_id, journal_id, period_id, entry_date, status, memo,
          currency_code, exchange_rate, source_type, source_id, reversal_of_id, created_by)
       VALUES ($1,$2,$3,$4,$5,'DRAFT',$6,$7,$8,$9,$10,$11,$12)`,
      [
        entry.id,
        entry.organizationId,
        entry.journalId,
        entry.periodId,
        entry.entryDate,
        entry.memo,
        entry.currencyCode,
        entry.exchangeRate,
        entry.sourceType,
        entry.sourceId,
        entry.reversalOfId,
        null,
      ],
    );

    if (lines.length === 0) return;
    await tx.client.query(
      `INSERT INTO journal_lines
         (id, organization_id, entry_id, position, account_id, party_id, cost_center_id,
          branch_id, description, debit, credit, base_debit, base_credit, reference)
       SELECT gen_random_uuid(), $1, $2, ord, account_id, party_id, cost_center_id,
              branch_id, description, debit, credit, base_debit, base_credit, reference
         FROM unnest(
           $3::smallint[], $4::uuid[], $5::uuid[], $6::uuid[], $7::uuid[], $8::text[],
           $9::numeric[], $10::numeric[], $11::numeric[], $12::numeric[], $13::text[]
         ) AS t(ord, account_id, party_id, cost_center_id, branch_id, description,
                debit, credit, base_debit, base_credit, reference)`,
      [
        entry.organizationId,
        entry.id,
        lines.map((_, i) => i + 1),
        lines.map((l) => l.accountId),
        lines.map((l) => l.partyId),
        lines.map((l) => l.costCenterId),
        lines.map((l) => l.branchId),
        lines.map((l) => l.description),
        lines.map((l) => l.debit),
        lines.map((l) => l.credit),
        lines.map((l) => l.baseDebit),
        lines.map((l) => l.baseCredit),
        lines.map((l) => l.reference),
      ],
    );
  }

  async post(
    tx: Tx,
    id: string,
    number: string,
    postedAt: Date,
    postedBy: string | null,
    debitTotal: string,
    creditTotal: string,
  ): Promise<void> {
    await tx.client.query(
      `UPDATE journal_entries
          SET status = 'POSTED', number = $2, posted_at = $3, posted_by = $4::uuid,
              debit_total = $5, credit_total = $6
        WHERE id = $1 AND status = 'DRAFT'`,
      [id, number, postedAt, postedBy, debitTotal, creditTotal],
    );
  }

  async markReversed(tx: Tx, id: string, reversalId: string): Promise<void> {
    await tx.client.query('UPDATE journal_entries SET reversed_by_id = $2 WHERE id = $1', [
      id,
      reversalId,
    ]);
  }

  async deleteDraft(tx: Tx, id: string): Promise<void> {
    await tx.client.query("DELETE FROM journal_entries WHERE id = $1 AND status = 'DRAFT'", [id]);
  }
}

/**
 * Informes.
 *
 * La suma la hace PostgreSQL. Traer las líneas a Node para sumarlas funcionaría
 * con la contabilidad de un mes y se caería con la de un año: un balance de
 * prueba de una empresa mediana recorre cientos de miles de filas, y el
 * resultado son cincuenta.
 */
export class PgReportRepository implements ReportRepository {
  /**
   * Saldos por cuenta: apertura antes del rango y movimiento dentro.
   *
   * Las dos cifras salen de UNA consulta con `FILTER`, no de dos. Con dos
   * consultas, una cuenta con movimiento en el rango pero sin saldo anterior
   * —o al revés— obliga a cruzar los resultados en Node y a decidir qué hacer
   * con las que solo aparecen en uno de los dos lados; con `FILTER` no hay nada
   * que cruzar.
   *
   * Solo cuenta los asientos CONTABILIZADOS: un borrador todavía no es un
   * hecho contable, y sumarlo daría un balance que cambia cuando alguien
   * descarta un borrador que nunca se contabilizó.
   */
  async balances(tx: Tx, query: LedgerQuery): Promise<LedgerRow[]> {
    const { rows } = await tx.client.query<{
      account_id: string;
      code: string;
      name: string;
      type: string;
      nature: string;
      opening_balance: string;
      debit: string;
      credit: string;
    }>(
      `SELECT a.id AS account_id, a.code, a.name, a.type, a.nature,
              COALESCE(SUM(
                CASE WHEN a.nature = 'DEBIT' THEN l.base_debit - l.base_credit
                     ELSE l.base_credit - l.base_debit END
              ) FILTER (WHERE e.entry_date < $1::date), 0)::text AS opening_balance,
              COALESCE(SUM(l.base_debit)
                FILTER (WHERE e.entry_date BETWEEN $1::date AND $2::date), 0)::text AS debit,
              COALESCE(SUM(l.base_credit)
                FILTER (WHERE e.entry_date BETWEEN $1::date AND $2::date), 0)::text AS credit
         FROM accounts a
         JOIN journal_lines l ON l.account_id = a.id
         JOIN journal_entries e ON e.id = l.entry_id AND e.status = 'POSTED'
        WHERE a.deleted_at IS NULL
          AND e.entry_date <= $2::date
          AND ($3::uuid IS NULL OR a.id = $3::uuid)
          AND ($4::uuid IS NULL OR l.party_id = $4::uuid)
          AND ($5::uuid IS NULL OR l.cost_center_id = $5::uuid)
        GROUP BY a.id, a.code, a.name, a.type, a.nature
        HAVING $6::boolean
            OR COALESCE(SUM(l.base_debit + l.base_credit)
                 FILTER (WHERE e.entry_date BETWEEN $1::date AND $2::date), 0) <> 0
            OR COALESCE(SUM(l.base_debit - l.base_credit)
                 FILTER (WHERE e.entry_date < $1::date), 0) <> 0
        ORDER BY a.code`,
      [
        query.from,
        query.to,
        query.accountId ?? null,
        query.partyId ?? null,
        query.costCenterId ?? null,
        query.includeZero ?? false,
      ],
    );

    return rows.map((r) => ({
      accountId: r.account_id,
      code: r.code,
      name: r.name,
      type: r.type as AccountType,
      nature: r.nature as AccountNature,
      openingBalance: r.opening_balance,
      debit: r.debit,
      credit: r.credit,
    }));
  }

  async movements(tx: Tx, query: LedgerQuery, limit: number): Promise<LedgerEntryRow[]> {
    const { rows } = await tx.client.query<{
      entry_id: string;
      number: string | null;
      entry_date: string;
      journal_code: string;
      memo: string;
      account_id: string;
      account_code: string;
      account_name: string;
      party_id: string | null;
      party_name: string | null;
      description: string;
      debit: string;
      credit: string;
      source_type: string;
      source_id: string | null;
    }>(
      `SELECT e.id AS entry_id, e.number, e.entry_date::text AS entry_date, j.code AS journal_code,
              e.memo, a.id AS account_id, a.code AS account_code, a.name AS account_name,
              l.party_id, pa.display_name AS party_name, l.description,
              l.base_debit::text AS debit, l.base_credit::text AS credit,
              e.source_type, e.source_id
         FROM journal_lines l
         JOIN journal_entries e ON e.id = l.entry_id AND e.status = 'POSTED'
         JOIN journals j ON j.id = e.journal_id
         JOIN accounts a ON a.id = l.account_id
         LEFT JOIN parties pa ON pa.id = l.party_id
        WHERE e.entry_date BETWEEN $1::date AND $2::date
          AND ($3::uuid IS NULL OR l.account_id = $3::uuid)
          AND ($4::uuid IS NULL OR l.party_id = $4::uuid)
          AND ($5::uuid IS NULL OR l.cost_center_id = $5::uuid)
        ORDER BY e.entry_date, e.number, l.position
        LIMIT $6`,
      [
        query.from,
        query.to,
        query.accountId ?? null,
        query.partyId ?? null,
        query.costCenterId ?? null,
        limit,
      ],
    );

    return rows.map((r) => ({
      entryId: r.entry_id,
      number: r.number,
      entryDate: r.entry_date,
      journalCode: r.journal_code,
      memo: r.memo,
      accountId: r.account_id,
      accountCode: r.account_code,
      accountName: r.account_name,
      partyId: r.party_id,
      partyName: r.party_name,
      description: r.description,
      debit: r.debit,
      credit: r.credit,
      sourceType: r.source_type,
      sourceId: r.source_id,
    }));
  }

  async partyBalances(
    tx: Tx,
    query: LedgerQuery,
  ): Promise<
    { partyId: string; partyName: string; accountCode: string; debit: string; credit: string }[]
  > {
    const { rows } = await tx.client.query<{
      party_id: string;
      party_name: string;
      account_code: string;
      debit: string;
      credit: string;
    }>(
      `SELECT l.party_id, pa.display_name AS party_name, a.code AS account_code,
              SUM(l.base_debit)::text AS debit, SUM(l.base_credit)::text AS credit
         FROM journal_lines l
         JOIN journal_entries e ON e.id = l.entry_id AND e.status = 'POSTED'
         JOIN accounts a ON a.id = l.account_id
         JOIN parties pa ON pa.id = l.party_id
        WHERE l.party_id IS NOT NULL
          AND e.entry_date BETWEEN $1::date AND $2::date
          AND ($3::uuid IS NULL OR l.account_id = $3::uuid)
          AND ($4::uuid IS NULL OR l.party_id = $4::uuid)
        GROUP BY l.party_id, pa.display_name, a.code
        ORDER BY pa.display_name, a.code`,
      [query.from, query.to, query.accountId ?? null, query.partyId ?? null],
    );
    return rows.map((r) => ({
      partyId: r.party_id,
      partyName: r.party_name,
      accountCode: r.account_code,
      debit: r.debit,
      credit: r.credit,
    }));
  }
}

import type { LocalDate } from '@erp/core';
import type { Tx } from '../../../../platform/db/unitOfWork.js';
import type { JournalType } from '../../domain/JournalEntry.js';
import type { PeriodStatus } from '../../domain/Periods.js';
import type {
  FiscalYearRecord,
  FiscalYearRepository,
  JournalRecord,
  JournalRepository,
  PeriodRecord,
  PeriodRepository,
} from '../../application/ports/AccountingRepositories.js';

/*
 * Las fechas se leen con `::text`.
 *
 * `start_date` es un `date` sin zona horaria; dejar que el driver lo convierta a
 * `Date` lo interpreta en la zona del servidor, y un periodo que empieza "el 1
 * de marzo" pasaría a empezar el 28 de febrero a las 19:00 en Colombia. La
 * comparación "¿esta fecha cae en este periodo?" empezaría a fallar un día antes
 * en cada frontera de mes, que es justo donde el cierre contable importa.
 */

interface YearDbRow {
  id: string;
  organization_id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: string;
  closed_at: Date | null;
}

const yearFrom = (r: YearDbRow): FiscalYearRecord => ({
  id: r.id,
  organizationId: r.organization_id,
  name: r.name,
  startDate: r.start_date,
  endDate: r.end_date,
  status: r.status as PeriodStatus,
  closedAt: r.closed_at ? r.closed_at.toISOString() : null,
});

const YEAR_COLUMNS = `
  id, organization_id, name, start_date::text AS start_date, end_date::text AS end_date,
  status, closed_at`;

export class PgFiscalYearRepository implements FiscalYearRepository {
  async list(tx: Tx): Promise<FiscalYearRecord[]> {
    const { rows } = await tx.client.query<YearDbRow>(
      `SELECT ${YEAR_COLUMNS} FROM fiscal_years ORDER BY start_date DESC`,
    );
    return rows.map(yearFrom);
  }

  async byId(tx: Tx, id: string): Promise<FiscalYearRecord | null> {
    const { rows } = await tx.client.query<YearDbRow>(
      `SELECT ${YEAR_COLUMNS} FROM fiscal_years WHERE id = $1`,
      [id],
    );
    return rows[0] ? yearFrom(rows[0]) : null;
  }

  async containing(tx: Tx, date: LocalDate): Promise<FiscalYearRecord | null> {
    const { rows } = await tx.client.query<YearDbRow>(
      `SELECT ${YEAR_COLUMNS} FROM fiscal_years WHERE $1::date BETWEEN start_date AND end_date`,
      [date],
    );
    return rows[0] ? yearFrom(rows[0]) : null;
  }

  async create(tx: Tx, year: FiscalYearRecord): Promise<void> {
    await tx.client.query(
      `INSERT INTO fiscal_years (id, organization_id, name, start_date, end_date, status)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [year.id, year.organizationId, year.name, year.startDate, year.endDate, year.status],
    );
  }

  async setStatus(
    tx: Tx,
    id: string,
    status: PeriodStatus,
    closedBy: string | null,
  ): Promise<void> {
    await tx.client.query(
      `UPDATE fiscal_years
          SET status = $2,
              closed_at = CASE WHEN $2 = 'CLOSED' THEN now() ELSE NULL END,
              closed_by = CASE WHEN $2 = 'CLOSED' THEN $3::uuid ELSE NULL END
        WHERE id = $1`,
      [id, status, closedBy],
    );
  }
}

interface PeriodDbRow {
  id: string;
  organization_id: string;
  fiscal_year_id: string;
  period_no: number;
  name: string;
  start_date: string;
  end_date: string;
  status: string;
  closed_at: Date | null;
}

const periodFrom = (r: PeriodDbRow): PeriodRecord => ({
  id: r.id,
  organizationId: r.organization_id,
  fiscalYearId: r.fiscal_year_id,
  periodNo: r.period_no,
  name: r.name,
  startDate: r.start_date,
  endDate: r.end_date,
  status: r.status as PeriodStatus,
  closedAt: r.closed_at ? r.closed_at.toISOString() : null,
});

const PERIOD_COLUMNS = `
  id, organization_id, fiscal_year_id, period_no, name,
  start_date::text AS start_date, end_date::text AS end_date, status, closed_at`;

export class PgPeriodRepository implements PeriodRepository {
  async ofYear(tx: Tx, fiscalYearId: string): Promise<PeriodRecord[]> {
    const { rows } = await tx.client.query<PeriodDbRow>(
      `SELECT ${PERIOD_COLUMNS} FROM accounting_periods WHERE fiscal_year_id = $1 ORDER BY period_no`,
      [fiscalYearId],
    );
    return rows.map(periodFrom);
  }

  async byId(tx: Tx, id: string): Promise<PeriodRecord | null> {
    const { rows } = await tx.client.query<PeriodDbRow>(
      `SELECT ${PERIOD_COLUMNS} FROM accounting_periods WHERE id = $1`,
      [id],
    );
    return rows[0] ? periodFrom(rows[0]) : null;
  }

  /**
   * El periodo de una fecha.
   *
   * `ORDER BY period_no` desempata el 31 de diciembre, que pertenece tanto a
   * diciembre como al periodo 13 de ajustes: una operación normal de ese día es
   * de diciembre, y quien quiera contabilizar en ajustes lo elige a mano.
   */
  async containing(tx: Tx, date: LocalDate): Promise<PeriodRecord | null> {
    const { rows } = await tx.client.query<PeriodDbRow>(
      `SELECT ${PERIOD_COLUMNS} FROM accounting_periods
        WHERE $1::date BETWEEN start_date AND end_date
        ORDER BY period_no
        LIMIT 1`,
      [date],
    );
    return rows[0] ? periodFrom(rows[0]) : null;
  }

  async createMany(tx: Tx, periods: readonly PeriodRecord[]): Promise<void> {
    if (periods.length === 0) return;
    // Una sola sentencia: trece viajes de ida y vuelta para abrir un año es
    // latencia que se nota en una API remota.
    await tx.client.query(
      `INSERT INTO accounting_periods
         (id, organization_id, fiscal_year_id, period_no, name, start_date, end_date, status)
       SELECT * FROM unnest(
         $1::uuid[], $2::uuid[], $3::uuid[], $4::smallint[], $5::text[],
         $6::date[], $7::date[], $8::text[])`,
      [
        periods.map((p) => p.id),
        periods.map((p) => p.organizationId),
        periods.map((p) => p.fiscalYearId),
        periods.map((p) => p.periodNo),
        periods.map((p) => p.name),
        periods.map((p) => p.startDate),
        periods.map((p) => p.endDate),
        periods.map((p) => p.status),
      ],
    );
  }

  async setStatus(tx: Tx, id: string, status: PeriodStatus, closedBy: string | null): Promise<void> {
    await tx.client.query(
      `UPDATE accounting_periods
          SET status = $2,
              closed_at = CASE WHEN $2 = 'CLOSED' THEN now() ELSE NULL END,
              closed_by = CASE WHEN $2 = 'CLOSED' THEN $3::uuid ELSE NULL END
        WHERE id = $1`,
      [id, status, closedBy],
    );
  }

  async entryCount(tx: Tx, id: string): Promise<number> {
    const { rows } = await tx.client.query<{ total: string }>(
      'SELECT count(*)::bigint AS total FROM journal_entries WHERE period_id = $1',
      [id],
    );
    return Number(rows[0]?.total ?? 0);
  }
}

interface JournalDbRow {
  id: string;
  organization_id: string;
  code: string;
  name: string;
  type: string;
  sequence_prefix: string;
  is_active: boolean;
}

const journalFrom = (r: JournalDbRow): JournalRecord => ({
  id: r.id,
  organizationId: r.organization_id,
  code: r.code,
  name: r.name,
  type: r.type as JournalType,
  sequencePrefix: r.sequence_prefix,
  isActive: r.is_active,
});

export class PgJournalRepository implements JournalRepository {
  async all(tx: Tx): Promise<JournalRecord[]> {
    const { rows } = await tx.client.query<JournalDbRow>(
      'SELECT id, organization_id, code, name, type, sequence_prefix, is_active FROM journals ORDER BY code',
    );
    return rows.map(journalFrom);
  }

  async byId(tx: Tx, id: string): Promise<JournalRecord | null> {
    const { rows } = await tx.client.query<JournalDbRow>(
      'SELECT id, organization_id, code, name, type, sequence_prefix, is_active FROM journals WHERE id = $1',
      [id],
    );
    return rows[0] ? journalFrom(rows[0]) : null;
  }

  async byType(tx: Tx, type: JournalType): Promise<JournalRecord | null> {
    const { rows } = await tx.client.query<JournalDbRow>(
      `SELECT id, organization_id, code, name, type, sequence_prefix, is_active
         FROM journals WHERE type = $1 AND is_active ORDER BY code LIMIT 1`,
      [type],
    );
    return rows[0] ? journalFrom(rows[0]) : null;
  }

  async create(tx: Tx, journal: JournalRecord): Promise<void> {
    await tx.client.query(
      `INSERT INTO journals (id, organization_id, code, name, type, sequence_prefix, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        journal.id,
        journal.organizationId,
        journal.code,
        journal.name,
        journal.type,
        journal.sequencePrefix,
        journal.isActive,
      ],
    );
  }

  async update(tx: Tx, journal: JournalRecord): Promise<void> {
    await tx.client.query(
      'UPDATE journals SET name = $2, sequence_prefix = $3, is_active = $4 WHERE id = $1',
      [journal.id, journal.name, journal.sequencePrefix, journal.isActive],
    );
  }
}

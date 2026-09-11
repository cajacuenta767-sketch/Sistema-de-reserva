import { newId } from '@erp/core';
import type { ListQuery } from '@erp/contracts';
import type { Tx } from '../../../../platform/db/unitOfWork.js';
import { runList, type ListResult, type ListSpec } from '../../../../platform/http/list.js';
import type { AccountNature, AccountType } from '../../domain/Account.js';
import { parentCodeOf } from '../../domain/Account.js';
import type {
  AccountRecord,
  AccountRepository,
  MappingRepository,
} from '../../application/ports/AccountingRepositories.js';
import { ACCOUNT_ROLES } from '../../domain/AccountRoles.js';

interface AccountDbRow {
  id: string;
  organization_id: string;
  code: string;
  name: string;
  parent_id: string | null;
  level: number;
  type: string;
  nature: string;
  is_postable: boolean;
  is_active: boolean;
  requires_party: boolean;
  requires_cost_center: boolean;
  is_cash: boolean;
  description: string | null;
}

const COLUMNS = `
  id, organization_id, code, name, parent_id, level, type, nature,
  is_postable, is_active, requires_party, requires_cost_center, is_cash, description`;

const fromRow = (r: AccountDbRow): AccountRecord => ({
  id: r.id,
  organizationId: r.organization_id,
  code: r.code,
  name: r.name,
  parentId: r.parent_id,
  level: r.level,
  type: r.type as AccountType,
  nature: r.nature as AccountNature,
  isPostable: r.is_postable,
  isActive: r.is_active,
  requiresParty: r.requires_party,
  requiresCostCenter: r.requires_cost_center,
  isCash: r.is_cash,
  description: r.description,
});

export class PgAccountRepository implements AccountRepository {
  private spec(): ListSpec {
    return {
      from: 'FROM accounts a',
      select: `
        a.id, a.code, a.name, a.level, a.type, a.nature, a.is_postable, a.is_active,
        a.requires_party, a.is_cash, a.description,
        (SELECT count(*) FROM accounts c WHERE c.parent_id = a.id AND c.deleted_at IS NULL) AS child_count`,
      fields: {
        code: { column: 'a.code', type: 'text', sortable: true, filterable: true, searchable: true },
        name: { column: 'a.name', type: 'text', sortable: true, filterable: true, searchable: true },
        level: { column: 'a.level', type: 'number', sortable: true, filterable: true },
        type: { column: 'a.type', type: 'text', sortable: true, filterable: true },
        nature: { column: 'a.nature', type: 'text', filterable: true },
        is_postable: { column: 'a.is_postable', type: 'boolean', filterable: true },
        is_active: { column: 'a.is_active', type: 'boolean', filterable: true },
        is_cash: { column: 'a.is_cash', type: 'boolean', filterable: true },
      },
      baseWhere: ['a.deleted_at IS NULL'],
      // Por código, que en el PUC es el orden natural del plan de cuentas.
      defaultSort: [{ field: 'code', dir: 'asc' }],
    };
  }

  async list(tx: Tx, query: ListQuery): Promise<ListResult<Record<string, unknown>>> {
    return runList(tx, this.spec(), query);
  }

  async tree(tx: Tx, onlyActive: boolean): Promise<AccountRecord[]> {
    const { rows } = await tx.client.query<AccountDbRow>(
      `SELECT ${COLUMNS} FROM accounts
        WHERE deleted_at IS NULL ${onlyActive ? 'AND is_active' : ''}
        ORDER BY code`,
    );
    return rows.map(fromRow);
  }

  async byId(tx: Tx, id: string): Promise<AccountRecord | null> {
    const { rows } = await tx.client.query<AccountDbRow>(
      `SELECT ${COLUMNS} FROM accounts WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async byCode(tx: Tx, code: string): Promise<AccountRecord | null> {
    const { rows } = await tx.client.query<AccountDbRow>(
      `SELECT ${COLUMNS} FROM accounts WHERE code = $1 AND deleted_at IS NULL`,
      [code],
    );
    return rows[0] ? fromRow(rows[0]) : null;
  }

  /** Una consulta para todas las cuentas de un asiento, no una por línea. */
  async byCodes(tx: Tx, codes: readonly string[]): Promise<Map<string, AccountRecord>> {
    if (codes.length === 0) return new Map();
    const { rows } = await tx.client.query<AccountDbRow>(
      `SELECT ${COLUMNS} FROM accounts WHERE code = ANY($1::text[]) AND deleted_at IS NULL`,
      [[...codes]],
    );
    return new Map(rows.map((r) => [r.code, fromRow(r)]));
  }

  async byIds(tx: Tx, ids: readonly string[]): Promise<Map<string, AccountRecord>> {
    if (ids.length === 0) return new Map();
    const { rows } = await tx.client.query<AccountDbRow>(
      `SELECT ${COLUMNS} FROM accounts WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
      [[...ids]],
    );
    return new Map(rows.map((r) => [r.id, fromRow(r)]));
  }

  async create(tx: Tx, account: AccountRecord): Promise<void> {
    await tx.client.query(
      `INSERT INTO accounts
         (id, organization_id, code, name, parent_id, level, type, nature,
          is_postable, is_active, requires_party, requires_cost_center, is_cash, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        account.id,
        account.organizationId,
        account.code,
        account.name,
        account.parentId,
        account.level,
        account.type,
        account.nature,
        account.isPostable,
        account.isActive,
        account.requiresParty,
        account.requiresCostCenter,
        account.isCash,
        account.description,
      ],
    );
  }

  async update(tx: Tx, account: AccountRecord): Promise<void> {
    await tx.client.query(
      `UPDATE accounts SET name = $2, nature = $3, is_active = $4, requires_party = $5,
              requires_cost_center = $6, is_cash = $7, description = $8
        WHERE id = $1`,
      [
        account.id,
        account.name,
        account.nature,
        account.isActive,
        account.requiresParty,
        account.requiresCostCenter,
        account.isCash,
        account.description,
      ],
    );
  }

  async softDelete(tx: Tx, id: string): Promise<void> {
    await tx.client.query('UPDATE accounts SET deleted_at = now() WHERE id = $1', [id]);
  }

  async hasMovements(tx: Tx, id: string): Promise<boolean> {
    const { rows } = await tx.client.query<{ exists: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM journal_lines WHERE account_id = $1) AS exists',
      [id],
    );
    return rows[0]?.exists ?? false;
  }

  async hasChildren(tx: Tx, id: string): Promise<boolean> {
    const { rows } = await tx.client.query<{ exists: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM accounts WHERE parent_id = $1 AND deleted_at IS NULL) AS exists',
      [id],
    );
    return rows[0]?.exists ?? false;
  }

  /**
   * Siembra el PUC de una empresa.
   *
   * Por orden de código, para que el padre exista antes que la hija: el
   * disparador que comprueba la jerarquía lo exige, y con razón —una cuenta
   * colgada de la nada no tiene dónde sumar en el balance—.
   *
   * `ON CONFLICT DO NOTHING` la hace idempotente: volver a ejecutarla no pisa el
   * nombre que la empresa le cambió a una cuenta ni reactiva las que desactivó.
   */
  async seed(
    tx: Tx,
    organizationId: string,
    accounts: readonly Omit<AccountRecord, 'id' | 'organizationId' | 'parentId'>[],
  ): Promise<number> {
    const existing = await tx.client.query<{ code: string; id: string }>(
      'SELECT code, id FROM accounts WHERE organization_id = $1',
      [organizationId],
    );
    const idByCode = new Map(existing.rows.map((r) => [r.code, r.id]));
    let created = 0;

    for (const account of [...accounts].sort((a, b) => a.code.localeCompare(b.code))) {
      if (idByCode.has(account.code)) continue;
      const id = newId();
      const parentCode = parentCodeOf(account.code);
      const { rowCount } = await tx.client.query(
        `INSERT INTO accounts
           (id, organization_id, code, name, parent_id, level, type, nature,
            is_postable, is_active, requires_party, requires_cost_center, is_cash, description)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10,$11,$12,$13)
         ON CONFLICT (organization_id, code) DO NOTHING`,
        [
          id,
          organizationId,
          account.code,
          account.name,
          parentCode === null ? null : (idByCode.get(parentCode) ?? null),
          account.level,
          account.type,
          account.nature,
          account.isPostable,
          account.requiresParty,
          account.requiresCostCenter,
          account.isCash,
          account.description,
        ],
      );
      idByCode.set(account.code, id);
      created += rowCount ?? 0;
    }
    return created;
  }
}

export class PgMappingRepository implements MappingRepository {
  async all(tx: Tx): Promise<Map<string, string>> {
    const { rows } = await tx.client.query<{ role: string; account_id: string }>(
      'SELECT role, account_id FROM account_mappings',
    );
    return new Map(rows.map((r) => [r.role, r.account_id]));
  }

  async set(tx: Tx, organizationId: string, role: string, accountId: string): Promise<void> {
    await tx.client.query(
      `INSERT INTO account_mappings (organization_id, role, account_id)
       VALUES ($1,$2,$3)
       ON CONFLICT (organization_id, role) DO UPDATE SET account_id = EXCLUDED.account_id`,
      [organizationId, role, accountId],
    );
  }

  /**
   * Resuelve cada rol contra la cuenta del PUC con la que se siembra.
   *
   * En una sola sentencia: son treinta roles y hacerlo con treinta viajes de ida
   * y vuelta multiplicaría por treinta la latencia de crear una empresa.
   */
  async seedDefaults(tx: Tx, organizationId: string): Promise<number> {
    const roles = ACCOUNT_ROLES.map((r) => r.role);
    const codes = ACCOUNT_ROLES.map((r) => r.defaultCode);
    const { rowCount } = await tx.client.query(
      `INSERT INTO account_mappings (organization_id, role, account_id)
       SELECT $1, m.role, a.id
         FROM unnest($2::text[], $3::text[]) AS m(role, code)
         JOIN accounts a ON a.organization_id = $1 AND a.code = m.code AND a.deleted_at IS NULL
       ON CONFLICT (organization_id, role) DO NOTHING`,
      [organizationId, roles, codes],
    );
    return rowCount ?? 0;
  }
}

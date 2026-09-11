import type { Tx } from '../../../../platform/db/unitOfWork.js';
import type { Branch, Organization } from '../../domain/Organization.js';
import type {
  BranchRepository,
  OrganizationRepository,
  SettingsRepository,
} from '../../application/ports/OrganizationRepository.js';

/** Fila de la tabla tal cual la devuelve PostgreSQL (snake_case). */
interface OrgRow {
  id: string;
  legal_name: string;
  trade_name: string;
  tax_id: string | null;
  tax_id_dv: string | null;
  tax_id_type: string;
  country: string;
  city: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  functional_currency: string;
  timezone: string;
  locale: string;
  fiscal_year_start_month: number;
  brand_hue: number | null;
  logo_file_id: string | null;
  plan: string;
  status: string;
  created_at: Date;
  updated_at: Date;
}

/** El mapeo fila→entidad vive en un solo sitio por tabla, nunca disperso. */
export const organizationFromRow = (r: OrgRow): Organization => ({
  id: r.id,
  legalName: r.legal_name,
  tradeName: r.trade_name,
  taxId: r.tax_id,
  taxIdDv: r.tax_id_dv,
  taxIdType: r.tax_id_type,
  country: r.country,
  city: r.city,
  address: r.address,
  phone: r.phone,
  email: r.email,
  website: r.website,
  functionalCurrency: r.functional_currency,
  timezone: r.timezone,
  locale: r.locale,
  fiscalYearStartMonth: r.fiscal_year_start_month,
  brandHue: r.brand_hue,
  logoFileId: r.logo_file_id,
  plan: r.plan as Organization['plan'],
  status: r.status as Organization['status'],
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const ORG_COLUMNS = `id, legal_name, trade_name, tax_id, tax_id_dv, tax_id_type, country, city, address,
  phone, email, website, functional_currency, timezone, locale, fiscal_year_start_month,
  brand_hue, logo_file_id, plan, status, created_at, updated_at`;

export class PgOrganizationRepository implements OrganizationRepository {
  async findById(tx: Tx, id: string): Promise<Organization | null> {
    const { rows } = await tx.client.query<OrgRow>(`SELECT ${ORG_COLUMNS} FROM organizations WHERE id = $1`, [
      id,
    ]);
    return rows[0] ? organizationFromRow(rows[0]) : null;
  }

  async findByTaxId(tx: Tx, country: string, taxId: string): Promise<Organization | null> {
    const { rows } = await tx.client.query<OrgRow>(
      `SELECT ${ORG_COLUMNS} FROM organizations WHERE country = $1 AND tax_id = $2`,
      [country, taxId],
    );
    return rows[0] ? organizationFromRow(rows[0]) : null;
  }

  async save(tx: Tx, o: Organization): Promise<void> {
    await tx.client.query(
      `INSERT INTO organizations
         (id, legal_name, trade_name, tax_id, tax_id_dv, tax_id_type, country, city, address, phone,
          email, website, functional_currency, timezone, locale, fiscal_year_start_month, brand_hue,
          logo_file_id, plan, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
      [
        o.id,
        o.legalName,
        o.tradeName,
        o.taxId,
        o.taxIdDv,
        o.taxIdType,
        o.country,
        o.city,
        o.address,
        o.phone,
        o.email,
        o.website,
        o.functionalCurrency,
        o.timezone,
        o.locale,
        o.fiscalYearStartMonth,
        o.brandHue,
        o.logoFileId,
        o.plan,
        o.status,
      ],
    );
  }

  async update(tx: Tx, o: Organization): Promise<void> {
    await tx.client.query(
      `UPDATE organizations SET
         legal_name=$2, trade_name=$3, tax_id=$4, tax_id_dv=$5, tax_id_type=$6, country=$7, city=$8,
         address=$9, phone=$10, email=$11, website=$12, functional_currency=$13, timezone=$14,
         locale=$15, fiscal_year_start_month=$16, brand_hue=$17, logo_file_id=$18, plan=$19, status=$20
       WHERE id=$1`,
      [
        o.id,
        o.legalName,
        o.tradeName,
        o.taxId,
        o.taxIdDv,
        o.taxIdType,
        o.country,
        o.city,
        o.address,
        o.phone,
        o.email,
        o.website,
        o.functionalCurrency,
        o.timezone,
        o.locale,
        o.fiscalYearStartMonth,
        o.brandHue,
        o.logoFileId,
        o.plan,
        o.status,
      ],
    );
  }

  async listForUser(tx: Tx, userId: string): Promise<Array<Organization & { membershipId: string }>> {
    const { rows } = await tx.client.query<OrgRow & { membership_id: string }>(
      `SELECT ${ORG_COLUMNS.split(',')
        .map((c) => `o.${c.trim()}`)
        .join(', ')}, m.id AS membership_id
         FROM organizations o
         JOIN memberships m ON m.organization_id = o.id
        WHERE m.user_id = $1 AND m.status = 'ACTIVE' AND o.status <> 'CLOSED'
        ORDER BY o.trade_name`,
      [userId],
    );
    return rows.map((r) => ({ ...organizationFromRow(r), membershipId: r.membership_id }));
  }
}

interface BranchRow {
  id: string;
  organization_id: string;
  code: string;
  name: string;
  address: string | null;
  city: string | null;
  phone: string | null;
  is_default: boolean;
  is_active: boolean;
}

export const branchFromRow = (r: BranchRow): Branch => ({
  id: r.id,
  organizationId: r.organization_id,
  code: r.code,
  name: r.name,
  address: r.address,
  city: r.city,
  phone: r.phone,
  isDefault: r.is_default,
  isActive: r.is_active,
});

const BRANCH_COLUMNS = 'id, organization_id, code, name, address, city, phone, is_default, is_active';

export class PgBranchRepository implements BranchRepository {
  async findById(tx: Tx, id: string): Promise<Branch | null> {
    const { rows } = await tx.client.query<BranchRow>(
      `SELECT ${BRANCH_COLUMNS} FROM branches WHERE id = $1`,
      [id],
    );
    return rows[0] ? branchFromRow(rows[0]) : null;
  }

  async listByOrganization(tx: Tx, organizationId: string): Promise<Branch[]> {
    const { rows } = await tx.client.query<BranchRow>(
      `SELECT ${BRANCH_COLUMNS} FROM branches WHERE organization_id = $1 ORDER BY is_default DESC, name`,
      [organizationId],
    );
    return rows.map(branchFromRow);
  }

  async save(tx: Tx, b: Branch): Promise<void> {
    await tx.client.query(
      `INSERT INTO branches (id, organization_id, code, name, address, city, phone, is_default, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [b.id, b.organizationId, b.code, b.name, b.address, b.city, b.phone, b.isDefault, b.isActive],
    );
  }

  async update(tx: Tx, b: Branch): Promise<void> {
    await tx.client.query(
      `UPDATE branches SET code=$2, name=$3, address=$4, city=$5, phone=$6, is_default=$7, is_active=$8
       WHERE id=$1`,
      [b.id, b.code, b.name, b.address, b.city, b.phone, b.isDefault, b.isActive],
    );
  }

  async delete(tx: Tx, id: string): Promise<void> {
    await tx.client.query('DELETE FROM branches WHERE id = $1', [id]);
  }

  async defaultFor(tx: Tx, organizationId: string): Promise<Branch | null> {
    const { rows } = await tx.client.query<BranchRow>(
      `SELECT ${BRANCH_COLUMNS} FROM branches WHERE organization_id = $1 AND is_default`,
      [organizationId],
    );
    return rows[0] ? branchFromRow(rows[0]) : null;
  }
}

export class PgSettingsRepository implements SettingsRepository {
  async get<T>(tx: Tx, organizationId: string, key: string): Promise<T | null> {
    const { rows } = await tx.client.query<{ value: T }>(
      'SELECT value FROM organization_settings WHERE organization_id = $1 AND key = $2',
      [organizationId, key],
    );
    return rows[0]?.value ?? null;
  }

  async all(tx: Tx, organizationId: string): Promise<Record<string, unknown>> {
    const { rows } = await tx.client.query<{ key: string; value: unknown }>(
      'SELECT key, value FROM organization_settings WHERE organization_id = $1',
      [organizationId],
    );
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  async set(tx: Tx, organizationId: string, key: string, value: unknown): Promise<void> {
    await tx.client.query(
      `INSERT INTO organization_settings (organization_id, key, value)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (organization_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [organizationId, key, JSON.stringify(value)],
    );
  }
}

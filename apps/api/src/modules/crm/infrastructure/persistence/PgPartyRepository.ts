import type { ListQuery } from '@erp/contracts';
import type { Tx } from '../../../../platform/db/unitOfWork.js';
import type { ScopeFilter } from '../../../../platform/authz/scope.js';
import { runList, type ListResult, type ListSpec } from '../../../../platform/http/list.js';
import type { Party, PartyAddress } from '../../domain/Party.js';
import type {
  AddressRepository,
  PartyOverview,
  PartyRepository,
  PartyRow,
} from '../../application/ports/CrmRepositories.js';

interface PartyDbRow {
  id: string;
  organization_id: string;
  kind: string;
  display_name: string;
  legal_name: string | null;
  tax_id_type: string;
  tax_id: string | null;
  tax_id_dv: string | null;
  fiscal_responsibilities: string[];
  tax_regime: string;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  website: string | null;
  industry: string | null;
  notes: string | null;
  is_customer: boolean;
  is_vendor: boolean;
  status: string;
  owner_membership_id: string | null;
  branch_id: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

const partyFromRow = (r: PartyDbRow): Party => ({
  id: r.id,
  organizationId: r.organization_id,
  kind: r.kind as Party['kind'],
  displayName: r.display_name,
  legalName: r.legal_name,
  taxIdType: r.tax_id_type as Party['taxIdType'],
  taxId: r.tax_id,
  taxIdDv: r.tax_id_dv,
  fiscalResponsibilities: r.fiscal_responsibilities,
  taxRegime: r.tax_regime as Party['taxRegime'],
  email: r.email,
  phone: r.phone,
  mobile: r.mobile,
  website: r.website,
  industry: r.industry,
  notes: r.notes,
  isCustomer: r.is_customer,
  isVendor: r.is_vendor,
  status: r.status as Party['status'],
  ownerMembershipId: r.owner_membership_id,
  branchId: r.branch_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  deletedAt: r.deleted_at,
});

const COLUMNS = `id, organization_id, kind, display_name, legal_name, tax_id_type, tax_id, tax_id_dv,
  fiscal_responsibilities, tax_regime, email, phone, mobile, website, industry, notes,
  is_customer, is_vendor, status, owner_membership_id, branch_id, created_at, updated_at, deleted_at`;

/**
 * Listado de partes.
 *
 * Las etiquetas, la ciudad y el número de contactos se traen con subconsultas en
 * lugar de JOIN: con JOIN, `count(*)` contaría filas del producto (una parte con
 * tres etiquetas contaría tres veces) y el total de la paginación sería falso.
 */
const listSpec = (): ListSpec => ({
  from: `FROM parties p LEFT JOIN memberships m ON m.id = p.owner_membership_id
         LEFT JOIN users u ON u.id = m.user_id`,
  select: `p.id, p.display_name, p.legal_name, p.tax_id_type, p.tax_id, p.tax_id_dv,
           p.email, p.phone, p.is_customer, p.is_vendor, p.status, p.created_at,
           (u.first_name || ' ' || u.last_name) AS owner_name,
           (SELECT a.city FROM party_addresses a
             WHERE a.party_id = p.id ORDER BY a.is_default DESC LIMIT 1) AS city,
           ARRAY(SELECT t.name FROM taggings tg JOIN tags t ON t.id = tg.tag_id
                  WHERE tg.entity_type = 'party' AND tg.entity_id = p.id ORDER BY t.name) AS tags,
           (SELECT count(*)::int FROM contacts c WHERE c.party_id = p.id) AS contact_count`,
  fields: {
    display_name: {
      column: 'p.display_name',
      type: 'text',
      sortable: true,
      filterable: true,
      searchable: true,
    },
    legal_name: { column: 'p.legal_name', type: 'text', sortable: true, filterable: true, searchable: true },
    tax_id: { column: 'p.tax_id', type: 'text', sortable: true, filterable: true, searchable: true },
    tax_id_type: { column: 'p.tax_id_type', type: 'text', sortable: true, filterable: true },
    email: { column: 'p.email', type: 'text', sortable: true, filterable: true, searchable: true },
    phone: { column: 'p.phone', type: 'text', sortable: false, filterable: true, searchable: true },
    is_customer: { column: 'p.is_customer', type: 'boolean', sortable: true, filterable: true },
    is_vendor: { column: 'p.is_vendor', type: 'boolean', sortable: true, filterable: true },
    status: { column: 'p.status', type: 'text', sortable: true, filterable: true },
    industry: { column: 'p.industry', type: 'text', sortable: true, filterable: true },
    owner_membership_id: { column: 'p.owner_membership_id', type: 'uuid', sortable: false, filterable: true },
    branch_id: { column: 'p.branch_id', type: 'uuid', sortable: false, filterable: true },
    city: {
      column: `(SELECT a.city FROM party_addresses a WHERE a.party_id = p.id ORDER BY a.is_default DESC LIMIT 1)`,
      type: 'text',
      sortable: true,
      filterable: true,
    },
    // `filter[tag]=<uuid>` → `$1 = ANY(...)`, sin JOIN que descuadre el conteo.
    tag: {
      column: `ARRAY(SELECT tg.tag_id::text FROM taggings tg
                WHERE tg.entity_type = 'party' AND tg.entity_id = p.id)`,
      type: 'array',
      sortable: false,
      filterable: true,
    },
    created_at: { column: 'p.created_at', type: 'timestamp', sortable: true, filterable: true },
  },
  baseWhere: ['p.deleted_at IS NULL'],
  defaultSort: [{ field: 'display_name', dir: 'asc' }],
  ownerColumn: 'p.owner_membership_id',
  branchColumn: 'p.branch_id',
  aggregates: {
    customers: 'count(*) FILTER (WHERE p.is_customer)::int',
    vendors: 'count(*) FILTER (WHERE p.is_vendor)::int',
    active: `count(*) FILTER (WHERE p.status = 'ACTIVE')::int`,
  },
});

export class PgPartyRepository implements PartyRepository {
  async findById(tx: Tx, id: string): Promise<Party | null> {
    const { rows } = await tx.client.query<PartyDbRow>(
      `SELECT ${COLUMNS} FROM parties WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return rows[0] ? partyFromRow(rows[0]) : null;
  }

  async findByTaxId(tx: Tx, organizationId: string, type: string, taxId: string): Promise<Party | null> {
    const { rows } = await tx.client.query<PartyDbRow>(
      `SELECT ${COLUMNS} FROM parties
        WHERE organization_id = $1 AND tax_id_type = $2 AND tax_id = $3 AND deleted_at IS NULL`,
      [organizationId, type, taxId],
    );
    return rows[0] ? partyFromRow(rows[0]) : null;
  }

  async list(tx: Tx, query: ListQuery, scope: ScopeFilter): Promise<ListResult<PartyRow>> {
    return runList<PartyRow>(tx, listSpec(), query, scope);
  }

  async save(tx: Tx, p: Party): Promise<void> {
    await tx.client.query(
      `INSERT INTO parties (id, organization_id, kind, display_name, legal_name, tax_id_type, tax_id,
        tax_id_dv, fiscal_responsibilities, tax_regime, email, phone, mobile, website, industry, notes,
        is_customer, is_vendor, status, owner_membership_id, branch_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::text[],$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
      [p.id, p.organizationId, p.kind, p.displayName, p.legalName, p.taxIdType, p.taxId, p.taxIdDv,
       p.fiscalResponsibilities, p.taxRegime, p.email, p.phone, p.mobile, p.website, p.industry,
       p.notes, p.isCustomer, p.isVendor, p.status, p.ownerMembershipId, p.branchId],
    );
  }

  async update(tx: Tx, p: Party): Promise<void> {
    await tx.client.query(
      `UPDATE parties SET kind=$2, display_name=$3, legal_name=$4, tax_id_type=$5, tax_id=$6,
        tax_id_dv=$7, fiscal_responsibilities=$8::text[], tax_regime=$9, email=$10, phone=$11,
        mobile=$12, website=$13, industry=$14, notes=$15, is_customer=$16, is_vendor=$17,
        status=$18, owner_membership_id=$19, branch_id=$20
       WHERE id=$1`,
      [p.id, p.kind, p.displayName, p.legalName, p.taxIdType, p.taxId, p.taxIdDv,
       p.fiscalResponsibilities, p.taxRegime, p.email, p.phone, p.mobile, p.website, p.industry,
       p.notes, p.isCustomer, p.isVendor, p.status, p.ownerMembershipId, p.branchId],
    );
  }

  async softDelete(tx: Tx, id: string, at: Date): Promise<void> {
    // Borrado lógico: una parte referenciada por facturas no puede desaparecer
    // sin dejar documentos huérfanos, y los documentos contables no se borran.
    await tx.client.query('UPDATE parties SET deleted_at = $2 WHERE id = $1', [id, at]);
    await tx.client.query(
      `DELETE FROM taggings WHERE entity_type = 'party' AND entity_id = $1`,
      [id],
    );
  }

  async overview(tx: Tx, organizationId: string, scope: ScopeFilter): Promise<PartyOverview> {
    const conditions = ['p.organization_id = $1', 'p.deleted_at IS NULL'];
    const params: unknown[] = [organizationId];

    if (scope.ownerMembershipId) {
      params.push(scope.ownerMembershipId);
      conditions.push(`p.owner_membership_id = $${params.length}::uuid`);
    } else if (scope.ownerMembershipIdIn) {
      params.push(scope.ownerMembershipIdIn);
      conditions.push(`p.owner_membership_id = ANY($${params.length}::uuid[])`);
    }

    const where = conditions.join(' AND ');
    const { rows } = await tx.client.query<Record<string, string>>(
      `SELECT
         count(*)::int AS total,
         count(*) FILTER (WHERE p.is_customer)::int AS customers,
         count(*) FILTER (WHERE p.is_vendor)::int AS vendors,
         count(*) FILTER (WHERE p.status = 'ACTIVE')::int AS active,
         count(*) FILTER (WHERE p.status <> 'ACTIVE')::int AS inactive,
         (SELECT count(*)::int FROM contacts c WHERE c.organization_id = $1) AS contacts,
         (SELECT count(*)::int FROM contacts c
           WHERE c.organization_id = $1 AND c.created_at >= date_trunc('day', now())) AS contacts_today,
         (SELECT count(*)::int FROM contacts c
           WHERE c.organization_id = $1 AND c.created_at >= now() - interval '7 days') AS contacts_last7
       FROM parties p WHERE ${where}`,
      params,
    );

    const r = rows[0] ?? {};
    return {
      total: Number(r['total'] ?? 0),
      customers: Number(r['customers'] ?? 0),
      vendors: Number(r['vendors'] ?? 0),
      active: Number(r['active'] ?? 0),
      inactive: Number(r['inactive'] ?? 0),
      contacts: Number(r['contacts'] ?? 0),
      contactsToday: Number(r['contacts_today'] ?? 0),
      contactsLast7Days: Number(r['contacts_last7'] ?? 0),
    };
  }

  async search(
    tx: Tx,
    organizationId: string,
    term: string,
    limit: number,
  ): Promise<Array<{ id: string; display_name: string; tax_id: string | null }>> {
    const { rows } = await tx.client.query<{ id: string; display_name: string; tax_id: string | null }>(
      `SELECT id, display_name, tax_id FROM parties
        WHERE organization_id = $1 AND deleted_at IS NULL
          AND (display_name ILIKE $2 OR legal_name ILIKE $2 OR tax_id ILIKE $2)
        ORDER BY display_name LIMIT $3`,
      [organizationId, `%${term}%`, limit],
    );
    return rows;
  }
}

// ── Direcciones ──────────────────────────────────────────────────────────────

interface AddressDbRow {
  id: string;
  organization_id: string;
  party_id: string;
  kind: string;
  label: string | null;
  line1: string;
  line2: string | null;
  city: string | null;
  state: string | null;
  country: string;
  postal_code: string | null;
  is_default: boolean;
}

const addressFromRow = (r: AddressDbRow): PartyAddress => ({
  id: r.id,
  organizationId: r.organization_id,
  partyId: r.party_id,
  kind: r.kind as PartyAddress['kind'],
  label: r.label,
  line1: r.line1,
  line2: r.line2,
  city: r.city,
  state: r.state,
  country: r.country,
  postalCode: r.postal_code,
  isDefault: r.is_default,
});

const ADDRESS_COLUMNS =
  'id, organization_id, party_id, kind, label, line1, line2, city, state, country, postal_code, is_default';

export class PgAddressRepository implements AddressRepository {
  async listByParty(tx: Tx, partyId: string): Promise<PartyAddress[]> {
    const { rows } = await tx.client.query<AddressDbRow>(
      `SELECT ${ADDRESS_COLUMNS} FROM party_addresses WHERE party_id = $1 ORDER BY is_default DESC, kind`,
      [partyId],
    );
    return rows.map(addressFromRow);
  }

  async findById(tx: Tx, id: string): Promise<PartyAddress | null> {
    const { rows } = await tx.client.query<AddressDbRow>(
      `SELECT ${ADDRESS_COLUMNS} FROM party_addresses WHERE id = $1`,
      [id],
    );
    return rows[0] ? addressFromRow(rows[0]) : null;
  }

  async save(tx: Tx, a: PartyAddress): Promise<void> {
    await tx.client.query(
      `INSERT INTO party_addresses (id, organization_id, party_id, kind, label, line1, line2, city,
        state, country, postal_code, is_default)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [a.id, a.organizationId, a.partyId, a.kind, a.label, a.line1, a.line2, a.city, a.state,
       a.country, a.postalCode, a.isDefault],
    );
  }

  async update(tx: Tx, a: PartyAddress): Promise<void> {
    await tx.client.query(
      `UPDATE party_addresses SET kind=$2, label=$3, line1=$4, line2=$5, city=$6, state=$7,
        country=$8, postal_code=$9, is_default=$10 WHERE id=$1`,
      [a.id, a.kind, a.label, a.line1, a.line2, a.city, a.state, a.country, a.postalCode, a.isDefault],
    );
  }

  async delete(tx: Tx, id: string): Promise<void> {
    await tx.client.query('DELETE FROM party_addresses WHERE id = $1', [id]);
  }
}

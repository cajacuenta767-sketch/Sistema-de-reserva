import type { ListQuery } from '@erp/contracts';
import type { Tx } from '../../../../platform/db/unitOfWork.js';
import type { ScopeFilter } from '../../../../platform/authz/scope.js';
import type { ListResult } from '../../../../platform/http/list.js';
import type {
  Contact,
  CustomerProfile,
  Party,
  PartyAddress,
  VendorProfile,
} from '../../domain/Party.js';

/** Fila del listado de partes: incluye lo que la tabla necesita mostrar. */
export interface PartyRow extends Record<string, unknown> {
  id: string;
  display_name: string;
  legal_name: string | null;
  tax_id_type: string;
  tax_id: string | null;
  tax_id_dv: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  is_customer: boolean;
  is_vendor: boolean;
  status: string;
  owner_name: string | null;
  tags: string[];
  contact_count: number;
  created_at: Date;
}

export interface PartyRepository {
  findById(tx: Tx, id: string): Promise<Party | null>;
  findByTaxId(tx: Tx, organizationId: string, type: string, taxId: string): Promise<Party | null>;
  list(tx: Tx, query: ListQuery, scope: ScopeFilter): Promise<ListResult<PartyRow>>;
  save(tx: Tx, party: Party): Promise<void>;
  update(tx: Tx, party: Party): Promise<void>;
  softDelete(tx: Tx, id: string, at: Date): Promise<void>;
  /** Contadores de la vista general, con el mismo filtro de alcance. */
  overview(tx: Tx, organizationId: string, scope: ScopeFilter): Promise<PartyOverview>;
  search(tx: Tx, organizationId: string, term: string, limit: number): Promise<Array<{ id: string; display_name: string; tax_id: string | null }>>;
}

export interface PartyOverview {
  total: number;
  customers: number;
  vendors: number;
  active: number;
  inactive: number;
  contacts: number;
  contactsToday: number;
  contactsLast7Days: number;
}

export interface AddressRepository {
  listByParty(tx: Tx, partyId: string): Promise<PartyAddress[]>;
  save(tx: Tx, address: PartyAddress): Promise<void>;
  update(tx: Tx, address: PartyAddress): Promise<void>;
  delete(tx: Tx, id: string): Promise<void>;
  findById(tx: Tx, id: string): Promise<PartyAddress | null>;
}

export interface ContactRow extends Record<string, unknown> {
  id: string;
  first_name: string;
  last_name: string;
  full_name: string;
  job_title: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  is_primary: boolean;
  party_id: string | null;
  party_name: string | null;
  created_at: Date;
}

export interface ContactRepository {
  findById(tx: Tx, id: string): Promise<Contact | null>;
  list(tx: Tx, query: ListQuery, scope: ScopeFilter): Promise<ListResult<ContactRow>>;
  listByParty(tx: Tx, partyId: string): Promise<Contact[]>;
  save(tx: Tx, contact: Contact): Promise<void>;
  update(tx: Tx, contact: Contact): Promise<void>;
  delete(tx: Tx, id: string): Promise<void>;
  /** Deja de ser principal a cualquier otro contacto de la misma parte. */
  clearPrimary(tx: Tx, partyId: string, exceptId: string): Promise<void>;
}

export interface ProfileRepository {
  customer(tx: Tx, partyId: string): Promise<CustomerProfile | null>;
  vendor(tx: Tx, partyId: string): Promise<VendorProfile | null>;
  upsertCustomer(tx: Tx, organizationId: string, profile: CustomerProfile): Promise<void>;
  upsertVendor(tx: Tx, organizationId: string, profile: VendorProfile): Promise<void>;
  removeCustomer(tx: Tx, partyId: string): Promise<void>;
  removeVendor(tx: Tx, partyId: string): Promise<void>;
}

export interface Activity {
  id: string;
  organizationId: string;
  kind: 'CALL' | 'EMAIL' | 'MEETING' | 'NOTE' | 'WHATSAPP' | 'TASK' | 'VISIT';
  entityType: string;
  entityId: string;
  subject: string;
  body: string | null;
  dueAt: Date | null;
  completedAt: Date | null;
  ownerMembershipId: string | null;
  createdAt: Date;
}

export interface ActivityRepository {
  findById(tx: Tx, id: string): Promise<Activity | null>;
  listForEntity(tx: Tx, entityType: string, entityId: string, limit: number): Promise<Activity[]>;
  save(tx: Tx, activity: Activity): Promise<void>;
  update(tx: Tx, activity: Activity): Promise<void>;
  delete(tx: Tx, id: string): Promise<void>;
}

export interface Tag {
  id: string;
  organizationId: string;
  kind: string;
  name: string;
  colorHue: number | null;
}

export interface TagRepository {
  list(tx: Tx, organizationId: string, kind?: string): Promise<Array<Tag & { usageCount: number }>>;
  findById(tx: Tx, id: string): Promise<Tag | null>;
  findByName(tx: Tx, organizationId: string, kind: string, name: string): Promise<Tag | null>;
  save(tx: Tx, tag: Tag): Promise<void>;
  update(tx: Tx, tag: Tag): Promise<void>;
  delete(tx: Tx, id: string): Promise<void>;
  /** Reemplaza el conjunto de etiquetas de una entidad. */
  setFor(tx: Tx, organizationId: string, entityType: string, entityId: string, tagIds: string[]): Promise<void>;
  forEntity(tx: Tx, entityType: string, entityId: string): Promise<Tag[]>;
}

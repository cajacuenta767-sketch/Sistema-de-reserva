import type { Tx } from '../../../../platform/db/unitOfWork.js';
import type { Branch, Organization } from '../../domain/Organization.js';

/**
 * Todos los repositorios del sistema tienen esta forma: `findById`, `list`,
 * `save`, `update`, `delete` más lo específico del dominio. Reciben siempre el
 * `Tx` de la transacción en curso, nunca el pool, para que una operación que
 * toca varias tablas se confirme o revierta entera.
 */
export interface OrganizationRepository {
  findById(tx: Tx, id: string): Promise<Organization | null>;
  findByTaxId(tx: Tx, country: string, taxId: string): Promise<Organization | null>;
  save(tx: Tx, org: Organization): Promise<void>;
  update(tx: Tx, org: Organization): Promise<void>;
  listForUser(tx: Tx, userId: string): Promise<Array<Organization & { membershipId: string }>>;
}

export interface BranchRepository {
  findById(tx: Tx, id: string): Promise<Branch | null>;
  listByOrganization(tx: Tx, organizationId: string): Promise<Branch[]>;
  save(tx: Tx, branch: Branch): Promise<void>;
  update(tx: Tx, branch: Branch): Promise<void>;
  delete(tx: Tx, id: string): Promise<void>;
  defaultFor(tx: Tx, organizationId: string): Promise<Branch | null>;
}

export interface SettingsRepository {
  get<T = unknown>(tx: Tx, organizationId: string, key: string): Promise<T | null>;
  all(tx: Tx, organizationId: string): Promise<Record<string, unknown>>;
  set(tx: Tx, organizationId: string, key: string, value: unknown): Promise<void>;
}

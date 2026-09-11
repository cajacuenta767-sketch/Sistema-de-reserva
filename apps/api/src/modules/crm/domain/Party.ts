/**
 * Parte: cualquier tercero con el que la empresa tiene relación.
 *
 * Una sola entidad para clientes y proveedores, con banderas y perfiles por rol.
 * Dos tablas separadas producen dos fichas del mismo NIT que se desincronizan:
 * alguien cambia la dirección en una, la otra sigue con la vieja, y las facturas
 * salen mal.
 */

export type PartyKind = 'PERSON' | 'COMPANY';
export type PartyStatus = 'ACTIVE' | 'INACTIVE' | 'BLOCKED';

/** Tipos de documento de la DIAN. */
export type TaxIdType =
  | 'NIT'
  | 'CC' // cédula de ciudadanía
  | 'CE' // cédula de extranjería
  | 'TI' // tarjeta de identidad
  | 'PP' // pasaporte
  | 'NIT_EXT'
  | 'PEP'
  | 'NUIP'
  | 'SIN_IDENTIFICAR';

export type TaxRegime = 'SIMPLIFICADO' | 'COMUN' | 'GRAN_CONTRIBUYENTE' | 'NO_RESIDENTE';

export interface Party {
  id: string;
  organizationId: string;
  kind: PartyKind;
  displayName: string;
  legalName: string | null;
  taxIdType: TaxIdType;
  taxId: string | null;
  taxIdDv: string | null;
  fiscalResponsibilities: string[];
  taxRegime: TaxRegime;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  website: string | null;
  industry: string | null;
  notes: string | null;
  isCustomer: boolean;
  isVendor: boolean;
  status: PartyStatus;
  ownerMembershipId: string | null;
  branchId: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface PartyAddress {
  id: string;
  organizationId: string;
  partyId: string;
  kind: 'MAIN' | 'BILLING' | 'SHIPPING' | 'OTHER';
  label: string | null;
  line1: string;
  line2: string | null;
  city: string | null;
  state: string | null;
  country: string;
  postalCode: string | null;
  isDefault: boolean;
}

export interface Contact {
  id: string;
  organizationId: string;
  partyId: string | null;
  firstName: string;
  lastName: string;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  isPrimary: boolean;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CustomerProfile {
  partyId: string;
  priceListId: string | null;
  paymentTermsDays: number;
  creditLimit: string;
  receivableAccountId: string | null;
  defaultCurrency: string;
  salespersonMembershipId: string | null;
  taxGroupId: string | null;
}

export interface VendorProfile {
  partyId: string;
  paymentTermsDays: number;
  payableAccountId: string | null;
  defaultCurrency: string;
  taxGroupId: string | null;
  leadTimeDays: number;
}

// ── Reglas puras ─────────────────────────────────────────────────────────────

const DV_WEIGHTS = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];

/**
 * Dígito de verificación del NIT (DIAN). Solo el NIT lo lleva: una cédula no
 * tiene dígito de verificación, y pedirlo o calcularlo para ella es un error
 * que se propaga hasta la factura electrónica.
 */
export const nitCheckDigit = (nit: string): number => {
  const digits = nit.replace(/\D/g, '');
  if (digits.length === 0 || digits.length > DV_WEIGHTS.length) {
    throw new Error(`NIT inválido: "${nit}"`);
  }
  const sum = [...digits]
    .reverse()
    .reduce((acc, digit, index) => acc + Number(digit) * (DV_WEIGHTS[index] ?? 0), 0);
  const remainder = sum % 11;
  return remainder > 1 ? 11 - remainder : remainder;
};

export const requiresCheckDigit = (type: TaxIdType): boolean => type === 'NIT';

export interface DocumentValidation {
  valid: boolean;
  reason?: string;
  /** Dígito de verificación calculado, cuando el tipo lo lleva. */
  checkDigit?: string;
}

/** Normaliza un documento: los NIT se escriben con puntos y guiones que sobran. */
export const normalizeTaxId = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  const cleaned = raw.replace(/[\s.-]/g, '').trim();
  return cleaned.length > 0 ? cleaned : null;
};

export const validateDocument = (
  type: TaxIdType,
  taxId: string | null,
  providedDv?: string | null,
): DocumentValidation => {
  if (type === 'SIN_IDENTIFICAR') return { valid: true };
  // Sin número no hay nada que validar. Exigirlo aquí impediría registrar un
  // prospecto del que solo se tiene el nombre y un teléfono, que es la mitad de
  // lo que entra en un CRM. La exigencia real —no se puede facturar a quien no
  // está identificado— vive en `assertInvoiceable`, que es donde se aplica.
  if (!taxId) return { valid: true };
  if (!/^\d+$/.test(taxId) && type !== 'PP' && type !== 'PEP') {
    return { valid: false, reason: 'El documento solo puede tener dígitos' };
  }

  if (!requiresCheckDigit(type)) return { valid: true };

  const expected = String(nitCheckDigit(taxId));
  if (providedDv != null && providedDv !== '' && providedDv !== expected) {
    return {
      valid: false,
      reason: `El dígito de verificación no corresponde al NIT ${taxId} (debería ser ${expected})`,
      checkDigit: expected,
    };
  }
  return { valid: true, checkDigit: expected };
};

/**
 * Una parte identificada es la que puede aparecer en un documento fiscal.
 *
 * Separado de `validateDocument` a propósito: un dato puede estar incompleto sin
 * ser inválido. El CRM acepta fichas incompletas; la facturación no.
 */
export const isInvoiceable = (party: Pick<Party, 'taxIdType' | 'taxId'>): boolean =>
  party.taxIdType === 'SIN_IDENTIFICAR' || Boolean(party.taxId);

/** Motivo por el que una parte no puede facturarse, o `null` si sí puede. */
export const invoiceabilityIssue = (
  party: Pick<Party, 'taxIdType' | 'taxId' | 'displayName'>,
): string | null =>
  isInvoiceable(party)
    ? null
    : `"${party.displayName}" no tiene número de documento; complétalo antes de facturarle`;

/** Nombre a mostrar, derivado cuando no se da uno explícito. */
export const deriveDisplayName = (input: {
  kind: PartyKind;
  displayName?: string | null;
  legalName?: string | null;
}): string => {
  const name = input.displayName?.trim() || input.legalName?.trim();
  if (!name) throw new Error('Una parte necesita al menos un nombre');
  return name;
};

/**
 * Una parte no puede dejar de ser cliente si tiene documentos a su nombre. Esa
 * comprobación la hace el caso de uso; aquí queda la regla básica: tiene que
 * desempeñar al menos un rol, o es una ficha que no sirve para nada.
 */
export const hasAnyRole = (party: Pick<Party, 'isCustomer' | 'isVendor'>): boolean =>
  party.isCustomer || party.isVendor;

export const fullContactName = (c: Pick<Contact, 'firstName' | 'lastName'>): string =>
  `${c.firstName} ${c.lastName}`.trim();

/** Responsabilidades fiscales DIAN más frecuentes, para el desplegable. */
export const FISCAL_RESPONSIBILITIES: ReadonlyArray<{ code: string; label: string }> = [
  { code: 'O-13', label: 'Gran contribuyente' },
  { code: 'O-15', label: 'Autorretenedor' },
  { code: 'O-23', label: 'Agente de retención de IVA' },
  { code: 'O-47', label: 'Régimen simple de tributación' },
  { code: 'R-99-PN', label: 'No aplica / otros' },
];

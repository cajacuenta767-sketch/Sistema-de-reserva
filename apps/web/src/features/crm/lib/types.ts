/**
 * Formas que devuelve la API de CRM.
 *
 * Se declaran aquí en lugar de importarse del backend: el frontend recibe JSON,
 * donde las fechas son cadenas ISO y no `Date`. Compartir el tipo del servidor
 * mentiría justo en los campos que se formatean.
 */

export interface Party {
  id: string;
  organizationId: string;
  kind: 'PERSON' | 'COMPANY';
  displayName: string;
  legalName: string | null;
  taxIdType: string;
  taxId: string | null;
  taxIdDv: string | null;
  fiscalResponsibilities: string[];
  taxRegime: string;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  website: string | null;
  industry: string | null;
  notes: string | null;
  isCustomer: boolean;
  isVendor: boolean;
  status: 'ACTIVE' | 'INACTIVE' | 'BLOCKED';
  ownerMembershipId: string | null;
  branchId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PartyAddress {
  id: string;
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
  partyId: string | null;
  firstName: string;
  lastName: string;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  isPrimary: boolean;
  notes: string | null;
  createdAt: string;
}

export interface CustomerProfile {
  partyId: string;
  priceListId: string | null;
  paymentTermsDays: number;
  creditLimit: string;
  defaultCurrency: string;
  salespersonMembershipId: string | null;
  taxGroupId: string | null;
}

export interface VendorProfile {
  partyId: string;
  paymentTermsDays: number;
  defaultCurrency: string;
  taxGroupId: string | null;
  leadTimeDays: number;
}

export interface PartyTag {
  id: string;
  name: string;
  colorHue: number | null;
}

export interface Activity {
  id: string;
  kind: 'CALL' | 'EMAIL' | 'MEETING' | 'NOTE' | 'WHATSAPP' | 'TASK' | 'VISIT';
  entityType: string;
  entityId: string;
  subject: string;
  body: string | null;
  dueAt: string | null;
  completedAt: string | null;
  ownerMembershipId: string | null;
  createdAt: string;
}

export interface PartyDetail {
  party: Party;
  addresses: PartyAddress[];
  contacts: Contact[];
  customerProfile: CustomerProfile | null;
  vendorProfile: VendorProfile | null;
  tags: PartyTag[];
  activities: Activity[];
}

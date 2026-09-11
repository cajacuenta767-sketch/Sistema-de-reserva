/** API pública del módulo CRM. */
export { crmModule, type CrmApi } from './module.js';
export type { Contact, Party, PartyAddress, TaxIdType } from './domain/Party.js';
export {
  FISCAL_RESPONSIBILITIES,
  fullContactName,
  invoiceabilityIssue,
  isInvoiceable,
  nitCheckDigit,
  normalizeTaxId,
  validateDocument,
} from './domain/Party.js';

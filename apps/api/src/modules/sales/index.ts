/** API pública del módulo de ventas. */
export { salesModule, type SalesApi } from './module.js';
export {
  computeDocumentTotals,
  type DocumentLineInput,
  type SalesDocumentTotals,
} from './domain/DocumentTotals.js';
export {
  computeWithholdings,
  totalWithheld,
  type ComputedWithholding,
  type WithholdingDef,
} from './domain/Withholding.js';
export {
  AGING_LABEL,
  agingBucket,
  daysOverdue,
  deriveInvoiceStatus,
  dueDateFrom,
  type AgingBucket,
  type InvoiceStatus,
  type QuoteStatus,
} from './domain/Invoice.js';
export { allocateOldestFirst, allocateManually, type OpenInvoice } from './domain/PaymentAllocation.js';

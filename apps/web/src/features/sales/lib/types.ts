/** Formas que devuelve la API de ventas (fechas e importes como texto). */

export type QuoteStatus = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'CONVERTED';
export type InvoiceStatus = 'DRAFT' | 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'VOID' | 'OVERDUE';

export interface StoredLineTax {
  taxId: string | null;
  code: string;
  kind: string;
  rate: string;
  base: string;
  amount: string;
}

export interface StoredLine {
  id: string;
  position: number;
  productId: string | null;
  variantId: string | null;
  description: string;
  sku: string | null;
  uomCode: string | null;
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  gross: string;
  discountAmount: string;
  subtotal: string;
  taxTotal: string;
  total: string;
  taxes: StoredLineTax[];
}

export interface StoredWithholding {
  taxId: string | null;
  code: string;
  name: string;
  kind: string;
  rate: string;
  base: string;
  amount: string;
}

export interface Invoice {
  id: string;
  number: string | null;
  partyId: string;
  quoteId: string | null;
  status: 'DRAFT' | 'ISSUED' | 'VOID';
  issueDate: string;
  dueDate: string;
  paymentTermsDays: number;
  currencyCode: string;
  globalDiscountPercent: string;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
  withholdingTotal: string;
  netPayable: string;
  paidTotal: string;
  notes: string | null;
  terms: string | null;
  issuedAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  createdAt: string;
}

export interface InvoiceDetail {
  invoice: Invoice;
  effectiveStatus: InvoiceStatus;
  outstanding: string;
  lines: StoredLine[];
  withholdings: StoredWithholding[];
  payments: Array<{ paymentId: string; number: string | null; paymentDate: string; amount: string }>;
}

export interface InvoiceRow {
  id: string;
  number: string | null;
  party_id: string;
  party_name: string;
  party_tax_id: string | null;
  status: string;
  effective_status: InvoiceStatus;
  issue_date: string;
  due_date: string;
  days_overdue: number;
  total: string;
  paid_total: string;
  outstanding: string;
  currency_code: string;
  owner_name: string | null;
}

export interface Quote {
  id: string;
  number: string;
  partyId: string;
  status: QuoteStatus;
  issueDate: string;
  validUntil: string | null;
  currencyCode: string;
  globalDiscountPercent: string;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
  notes: string | null;
  terms: string | null;
  convertedInvoiceId: string | null;
}

export interface QuoteDetail {
  quote: Quote;
  lines: StoredLine[];
  isExpired: boolean;
}

export interface QuoteRow {
  id: string;
  number: string;
  party_name: string;
  status: QuoteStatus;
  issue_date: string;
  valid_until: string | null;
  total: string;
  currency_code: string;
  owner_name: string | null;
  converted_invoice_id: string | null;
}

export interface PaymentRow {
  id: string;
  number: string | null;
  party_name: string;
  payment_date: string;
  method: string;
  amount: string;
  allocated_total: string;
  unapplied: string;
  currency_code: string;
  reference: string | null;
  voided_at: string | null;
}

export interface OpenInvoice {
  id: string;
  number: string | null;
  issueDate: string;
  dueDate: string;
  total: string;
  paid: string;
  outstanding: string;
  currencyCode: string;
}

export interface SalesOverview {
  draftCount: number;
  issuedCount: number;
  overdueCount: number;
  outstanding: string;
  overdueAmount: string;
  issuedThisMonth: string;
  collectedThisMonth: string;
}

export interface AgingRow {
  partyId: string;
  partyName: string;
  current: string;
  d1_30: string;
  d31_60: string;
  d61_90: string;
  d90_plus: string;
  total: string;
}

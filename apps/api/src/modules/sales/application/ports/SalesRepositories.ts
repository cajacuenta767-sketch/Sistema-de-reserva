import type { ListQuery } from '@erp/contracts';
import type { Tx } from '../../../../platform/db/unitOfWork.js';
import type { ScopeFilter } from '../../../../platform/authz/scope.js';
import type { ListResult } from '../../../../platform/http/list.js';
import type { InvoiceStatus, QuoteStatus } from '../../domain/Invoice.js';

/** Línea tal como se guarda: con su precio y su impuesto congelados. */
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

export interface StoredLineTax {
  taxId: string | null;
  code: string;
  kind: string;
  rate: string;
  base: string;
  amount: string;
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

export interface Quote {
  id: string;
  organizationId: string;
  number: string;
  partyId: string;
  contactId: string | null;
  status: QuoteStatus;
  issueDate: string;
  validUntil: string | null;
  currencyCode: string;
  priceListId: string | null;
  globalDiscountPercent: string;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
  notes: string | null;
  terms: string | null;
  convertedInvoiceId: string | null;
  ownerMembershipId: string | null;
  branchId: string | null;
  createdAt: Date;
}

export interface Invoice {
  id: string;
  organizationId: string;
  number: string | null;
  partyId: string;
  quoteId: string | null;
  /** Estado ALMACENADO: DRAFT, ISSUED o VOID. El de cartera se deriva del saldo. */
  status: 'DRAFT' | 'ISSUED' | 'VOID';
  issueDate: string;
  dueDate: string;
  paymentTermsDays: number;
  currencyCode: string;
  exchangeRate: string;
  priceListId: string | null;
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
  dianResolution: string | null;
  issuedAt: Date | null;
  voidedAt: Date | null;
  voidReason: string | null;
  ownerMembershipId: string | null;
  branchId: string | null;
  createdAt: Date;
}

export interface QuoteRow extends Record<string, unknown> {
  id: string;
  number: string;
  party_name: string;
  status: string;
  issue_date: string;
  valid_until: string | null;
  total: string;
  currency_code: string;
  owner_name: string | null;
  converted_invoice_id: string | null;
}

export interface InvoiceRow extends Record<string, unknown> {
  id: string;
  number: string | null;
  party_id: string;
  party_name: string;
  party_tax_id: string | null;
  status: string;
  /** Derivado del saldo y del vencimiento: es lo que la cartera necesita. */
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

export interface QuoteRepository {
  findById(tx: Tx, id: string): Promise<Quote | null>;
  list(tx: Tx, query: ListQuery, scope: ScopeFilter): Promise<ListResult<QuoteRow>>;
  save(tx: Tx, quote: Quote): Promise<void>;
  update(tx: Tx, quote: Quote): Promise<void>;
  softDelete(tx: Tx, id: string, at: Date): Promise<void>;
}

export interface InvoiceRepository {
  findById(tx: Tx, id: string): Promise<Invoice | null>;
  findByNumber(tx: Tx, organizationId: string, number: string): Promise<Invoice | null>;
  /** `today` viene del reloj inyectado: decide qué figura como vencido. */
  list(tx: Tx, query: ListQuery, scope: ScopeFilter, today: string): Promise<ListResult<InvoiceRow>>;
  save(tx: Tx, invoice: Invoice): Promise<void>;
  update(tx: Tx, invoice: Invoice): Promise<void>;
  delete(tx: Tx, id: string): Promise<void>;
  /** Facturas emitidas con saldo, para imputar un pago. */
  openForParty(tx: Tx, organizationId: string, partyId: string): Promise<Invoice[]>;
  /** Suma lo imputado desde `payment_allocations`: es la única fuente de verdad. */
  recalculatePaid(tx: Tx, invoiceId: string): Promise<string>;
  /**
   * Desglose que la contabilidad necesita y el documento no guarda sumado.
   *
   * `tax_total` mezcla IVA e INC, que van a cuentas distintas, y el ingreso de
   * mercancías y el de servicios también. Sin este desglose el asiento cuadra
   * —los totales son los mismos— pero lleva el IVA y el INC a la misma cuenta,
   * y la declaración de IVA sale mal sin que nada parezca roto.
   */
  accountingBreakdown(tx: Tx, invoiceId: string): Promise<InvoiceBreakdown>;
  /**
   * Líneas que mueven inventario, para que el módulo que lo lleva las descuente.
   *
   * Se resuelve AQUÍ y no allí porque quien tiene delante las líneas de la
   * factura es este repositorio. El evento lleva el resultado: un suscriptor que
   * tuviera que volver a consultar las líneas de la factura estaría leyendo el
   * agregado de otro módulo, que es justo lo que los eventos evitan.
   */
  stockLines(tx: Tx, invoiceId: string): Promise<InvoiceStockLine[]>;
  aging(tx: Tx, organizationId: string, today: string, scope: ScopeFilter): Promise<AgingRow[]>;
  overview(tx: Tx, organizationId: string, today: string, scope: ScopeFilter): Promise<SalesOverview>;
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

export interface SalesOverview {
  draftCount: number;
  issuedCount: number;
  overdueCount: number;
  /** Cartera total pendiente. */
  outstanding: string;
  overdueAmount: string;
  /** Facturado en el mes en curso. */
  issuedThisMonth: string;
  collectedThisMonth: string;
}

/** Las líneas y sus impuestos se escriben y se leen juntos, siempre. */
export interface LineRepository {
  listFor(tx: Tx, parent: { quoteId?: string; invoiceId?: string; creditNoteId?: string }): Promise<StoredLine[]>;
  replaceAll(
    tx: Tx,
    organizationId: string,
    parent: { quoteId?: string; invoiceId?: string; creditNoteId?: string },
    lines: readonly Omit<StoredLine, 'id'>[],
  ): Promise<void>;
}

/** Cifras de una factura repartidas por su destino contable. */
export interface InvoiceBreakdown {
  /** El tercero, para la glosa del asiento y el auxiliar. */
  partyName: string;
  goodsRevenue: string;
  servicesRevenue: string;
  vat: string;
  consumptionTax: string;
  otherTax: string;
}

export interface InvoiceStockLine {
  productId: string;
  quantity: string;
}

export interface WithholdingRepository {
  listFor(tx: Tx, invoiceId: string): Promise<StoredWithholding[]>;
  replaceAll(
    tx: Tx,
    organizationId: string,
    invoiceId: string,
    items: readonly StoredWithholding[],
  ): Promise<void>;
}

export interface Payment {
  id: string;
  organizationId: string;
  number: string | null;
  partyId: string;
  direction: 'IN' | 'OUT';
  paymentDate: string;
  method: 'CASH' | 'TRANSFER' | 'CARD' | 'CHECK' | 'OTHER';
  currencyCode: string;
  amount: string;
  allocatedTotal: string;
  reference: string | null;
  notes: string | null;
  voidedAt: Date | null;
  voidReason: string | null;
  createdAt: Date;
}

export interface PaymentRow extends Record<string, unknown> {
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
  voided_at: Date | null;
}

export interface PaymentRepository {
  findById(tx: Tx, id: string): Promise<Payment | null>;
  list(tx: Tx, query: ListQuery): Promise<ListResult<PaymentRow>>;
  /** Nombre del tercero, para la glosa del asiento. */
  partyNameOf(tx: Tx, partyId: string): Promise<string>;
  save(tx: Tx, payment: Payment): Promise<void>;
  update(tx: Tx, payment: Payment): Promise<void>;
  allocations(tx: Tx, paymentId: string): Promise<Array<{ invoiceId: string; number: string | null; amount: string }>>;
  allocationsForInvoice(
    tx: Tx,
    invoiceId: string,
  ): Promise<Array<{ paymentId: string; number: string | null; paymentDate: string; amount: string }>>;
  replaceAllocations(
    tx: Tx,
    organizationId: string,
    paymentId: string,
    lines: ReadonlyArray<{ invoiceId: string; amount: string }>,
  ): Promise<void>;
}

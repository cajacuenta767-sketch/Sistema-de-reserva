import type { ListQuery } from '@erp/contracts';
import type { LocalDate } from '@erp/core';
import type { Tx } from '../../../../platform/db/unitOfWork.js';
import type { ListResult } from '../../../../platform/http/list.js';

export interface PurchaseOrder {
  id: string;
  organizationId: string;
  number: string | null;
  partyId: string;
  warehouseId: string | null;
  status: 'DRAFT' | 'SENT' | 'PARTIAL' | 'RECEIVED' | 'CANCELLED';
  orderDate: LocalDate;
  expectedDate: LocalDate | null;
  currencyCode: string;
  exchangeRate: string;
  subtotal: string;
  taxTotal: string;
  total: string;
  notes: string | null;
  terms: string | null;
  ownerMembershipId: string | null;
  branchId: string | null;
}

export interface OrderLine {
  id: string;
  position: number;
  productId: string | null;
  description: string;
  sku: string | null;
  uomCode: string | null;
  quantity: string;
  received: string;
  pending: string;
  unitPrice: string;
  discountPercent: string;
  taxId: string | null;
  subtotal: string;
  taxTotal: string;
  total: string;
}

export interface PurchaseOrderRepository {
  list(tx: Tx, query: ListQuery): Promise<ListResult<Record<string, unknown>>>;
  byId(tx: Tx, id: string): Promise<PurchaseOrder | null>;
  linesOf(tx: Tx, orderId: string): Promise<OrderLine[]>;
  partyNameOf(tx: Tx, partyId: string): Promise<string>;
  save(tx: Tx, order: PurchaseOrder, createdBy: string | null): Promise<void>;
  update(tx: Tx, order: PurchaseOrder): Promise<void>;
  replaceLines(
    tx: Tx,
    organizationId: string,
    orderId: string,
    lines: readonly Omit<OrderLine, 'id' | 'received' | 'pending'>[],
  ): Promise<void>;
  /** Recalcula lo recibido DESDE las recepciones, nunca incrementando. */
  recalculateReceived(tx: Tx, orderId: string): Promise<void>;
  setStatus(tx: Tx, id: string, status: PurchaseOrder['status']): Promise<void>;
  softDelete(tx: Tx, id: string): Promise<void>;
  /** Lo pendiente de llegar, para el panel de compras. */
  overview(tx: Tx, today: LocalDate): Promise<PurchasingOverview>;
}

export interface PurchasingOverview {
  openOrders: number;
  lateOrders: number;
  expectedThisWeek: string;
  payable: string;
  overduePayable: string;
  overdueBills: number;
}

export interface GoodsReceipt {
  id: string;
  organizationId: string;
  number: string | null;
  partyId: string;
  orderId: string | null;
  warehouseId: string;
  status: 'DRAFT' | 'POSTED' | 'VOID';
  receiptDate: LocalDate;
  reference: string | null;
  notes: string | null;
}

export interface ReceiptLine {
  id: string;
  position: number;
  orderLineId: string | null;
  productId: string;
  lotId: string | null;
  description: string;
  quantity: string;
  unitCost: string;
}

export interface ReceiptRepository {
  list(tx: Tx, query: ListQuery): Promise<ListResult<Record<string, unknown>>>;
  byId(tx: Tx, id: string): Promise<GoodsReceipt | null>;
  linesOf(tx: Tx, receiptId: string): Promise<ReceiptLine[]>;
  save(tx: Tx, receipt: GoodsReceipt, createdBy: string | null): Promise<void>;
  update(tx: Tx, receipt: GoodsReceipt): Promise<void>;
  replaceLines(
    tx: Tx,
    organizationId: string,
    receiptId: string,
    lines: readonly Omit<ReceiptLine, 'id'>[],
  ): Promise<void>;
  post(tx: Tx, id: string, number: string): Promise<void>;
  void(tx: Tx, id: string, reason: string): Promise<void>;
  ofOrder(tx: Tx, orderId: string): Promise<GoodsReceipt[]>;
}

export interface Bill {
  id: string;
  organizationId: string;
  number: string | null;
  supplierNumber: string;
  partyId: string;
  orderId: string | null;
  receiptId: string | null;
  status: 'DRAFT' | 'POSTED' | 'VOID';
  issueDate: LocalDate;
  dueDate: LocalDate;
  paymentTermsDays: number;
  currencyCode: string;
  exchangeRate: string;
  subtotal: string;
  taxTotal: string;
  total: string;
  withholdingTotal: string;
  netPayable: string;
  paidTotal: string;
  notes: string | null;
  ownerMembershipId: string | null;
  branchId: string | null;
}

export interface BillLine {
  id: string;
  position: number;
  productId: string | null;
  accountId: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  subtotal: string;
  taxTotal: string;
  total: string;
  taxes: Array<{
    taxId: string | null;
    code: string;
    kind: string;
    rate: string;
    base: string;
    amount: string;
  }>;
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

export interface BillRepository {
  list(tx: Tx, query: ListQuery, today: LocalDate): Promise<ListResult<Record<string, unknown>>>;
  byId(tx: Tx, id: string): Promise<Bill | null>;
  bySupplierNumber(tx: Tx, partyId: string, supplierNumber: string): Promise<Bill | null>;
  linesOf(tx: Tx, billId: string): Promise<BillLine[]>;
  withholdingsOf(tx: Tx, billId: string): Promise<StoredWithholding[]>;
  save(tx: Tx, bill: Bill, createdBy: string | null): Promise<void>;
  update(tx: Tx, bill: Bill): Promise<void>;
  replaceLines(
    tx: Tx,
    organizationId: string,
    billId: string,
    lines: readonly Omit<BillLine, 'id'>[],
  ): Promise<void>;
  replaceWithholdings(
    tx: Tx,
    organizationId: string,
    billId: string,
    items: readonly StoredWithholding[],
  ): Promise<void>;
  post(tx: Tx, id: string, number: string): Promise<void>;
  void(tx: Tx, id: string, reason: string): Promise<void>;
  /** Suma lo pagado desde las imputaciones: la única fuente de verdad. */
  recalculatePaid(tx: Tx, billId: string): Promise<string>;
  openForParty(tx: Tx, partyId: string): Promise<Bill[]>;
  allocations(
    tx: Tx,
    paymentId: string,
  ): Promise<Array<{ billId: string; number: string | null; amount: string }>>;
  replaceAllocations(
    tx: Tx,
    organizationId: string,
    paymentId: string,
    lines: ReadonlyArray<{ billId: string; amount: string }>,
  ): Promise<void>;
  payable(tx: Tx, today: LocalDate): Promise<PayableRow[]>;
}

export interface PayableRow {
  partyId: string;
  partyName: string;
  current: string;
  d1_30: string;
  d31_60: string;
  d61_90: string;
  d90_plus: string;
  total: string;
}

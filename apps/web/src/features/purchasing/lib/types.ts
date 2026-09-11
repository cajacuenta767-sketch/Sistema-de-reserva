export interface OrderRow {
  id: string;
  number: string | null;
  order_date: string;
  expected_date: string | null;
  status: 'DRAFT' | 'SENT' | 'PARTIAL' | 'RECEIVED' | 'CANCELLED';
  party_id: string;
  party_name: string;
  party_tax_id: string | null;
  warehouse_name: string | null;
  currency_code: string;
  total: string;
  received_percent: number;
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
  subtotal: string;
  taxTotal: string;
  total: string;
}

export interface OrderDetail {
  order: {
    id: string;
    number: string | null;
    partyId: string;
    warehouseId: string | null;
    status: OrderRow['status'];
    orderDate: string;
    expectedDate: string | null;
    currencyCode: string;
    subtotal: string;
    taxTotal: string;
    total: string;
    notes: string | null;
    terms: string | null;
  };
  partyName: string;
  lines: OrderLine[];
  receipts: Array<{ id: string; number: string | null; receiptDate: string; status: string }>;
  match: Array<{
    description: string;
    ordered: string;
    received: string;
    billed: string;
    matches: boolean;
    issues: string[];
  }>;
}

export interface ReceiptRow {
  id: string;
  number: string | null;
  receipt_date: string;
  status: 'DRAFT' | 'POSTED' | 'VOID';
  reference: string | null;
  party_id: string;
  party_name: string;
  warehouse_name: string;
  order_number: string | null;
  order_id: string | null;
  line_count: number;
  total_cost: string;
}

export interface ReceiptDetail {
  receipt: {
    id: string;
    number: string | null;
    partyId: string;
    orderId: string | null;
    warehouseId: string;
    status: ReceiptRow['status'];
    receiptDate: string;
    reference: string | null;
    notes: string | null;
  };
  lines: Array<{
    id: string;
    position: number;
    orderLineId: string | null;
    productId: string;
    description: string;
    quantity: string;
    unitCost: string;
  }>;
}

export interface BillRow {
  id: string;
  number: string | null;
  supplier_number: string;
  issue_date: string;
  due_date: string;
  status: 'DRAFT' | 'POSTED' | 'VOID';
  party_id: string;
  party_name: string;
  party_tax_id: string | null;
  currency_code: string;
  total: string;
  paid_total: string;
  outstanding: string;
  days_overdue: number;
  effective_status: string;
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

export interface PurchasingOverview {
  openOrders: number;
  lateOrders: number;
  expectedThisWeek: string;
  payable: string;
  overduePayable: string;
  overdueBills: number;
}

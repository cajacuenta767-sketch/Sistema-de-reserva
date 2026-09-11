export type MoveKind =
  | 'RECEIPT'
  | 'ISSUE'
  | 'ADJUSTMENT'
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT'
  | 'RETURN_IN'
  | 'RETURN_OUT'
  | 'OPENING'
  | 'COUNT';

export interface Warehouse {
  id: string;
  code: string;
  name: string;
  city: string | null;
  isDefault: boolean;
  isActive: boolean;
}

export interface WarehouseRow {
  id: string;
  code: string;
  name: string;
  city: string | null;
  is_default: boolean;
  is_active: boolean;
  total_units: string;
  total_value: string;
}

export interface StockRow {
  product_id: string;
  product_name: string;
  sku: string | null;
  warehouse_id: string;
  warehouse_name: string;
  quantity: string;
  reserved: string;
  available: string;
  average_cost: string;
  value: string;
  min_stock: string | null;
  below_minimum: boolean;
}

export interface MoveRow {
  id: string;
  move_date: string;
  kind: MoveKind;
  product_id: string;
  product_name: string;
  sku: string | null;
  warehouse_id: string;
  warehouse_name: string;
  lot_code: string | null;
  quantity: string;
  unit_cost: string;
  total_cost: string;
  balance_after: string;
  average_after: string;
  source_type: string;
  source_id: string | null;
  notes: string | null;
}

export interface KardexMove {
  id: string;
  moveDate: string;
  kind: MoveKind;
  productName: string;
  warehouseName: string;
  lotCode: string | null;
  quantity: string;
  unitCost: string;
  totalCost: string;
  balanceAfter: string;
  averageAfter: string;
  sourceType: string;
  sourceId: string | null;
  notes: string | null;
}

export interface CountRow {
  id: string;
  number: string | null;
  count_date: string;
  status: 'DRAFT' | 'COUNTING' | 'APPLIED' | 'CANCELLED';
  warehouse_id: string;
  warehouse_name: string;
  line_count: number;
  counted_count: number;
}

export interface CountLine {
  id: string;
  productId: string;
  productName: string;
  sku: string | null;
  expected: string;
  counted: string | null;
  difference: string | null;
  notes: string | null;
}

export interface CountDetail {
  count: {
    id: string;
    number: string | null;
    warehouseId: string;
    warehouseName: string;
    status: CountRow['status'];
    countDate: string;
    notes: string | null;
    appliedAt: string | null;
  };
  lines: CountLine[];
  summary: {
    lines: number;
    counted: number;
    pending: number;
    withDifference: number;
    netDifference: string;
  };
}

import type { ListQuery } from '@erp/contracts';
import type { Decimal, LocalDate } from '@erp/core';
import type { Tx } from '../../../../platform/db/unitOfWork.js';
import type { ListResult } from '../../../../platform/http/list.js';
import type { MoveKind } from '../../domain/StockMove.js';
import type { StockState } from '../../domain/Costing.js';

export interface WarehouseRecord {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  branchId: string | null;
  address: string | null;
  city: string | null;
  isDefault: boolean;
  isActive: boolean;
}

export interface WarehouseRepository {
  list(tx: Tx, query: ListQuery): Promise<ListResult<Record<string, unknown>>>;
  all(tx: Tx): Promise<WarehouseRecord[]>;
  byId(tx: Tx, id: string): Promise<WarehouseRecord | null>;
  byCode(tx: Tx, code: string): Promise<WarehouseRecord | null>;
  defaultOne(tx: Tx): Promise<WarehouseRecord | null>;
  create(tx: Tx, warehouse: WarehouseRecord): Promise<void>;
  update(tx: Tx, warehouse: WarehouseRecord): Promise<void>;
  /** Deja una sola bodega por defecto, sin depender del orden de escritura. */
  clearDefault(tx: Tx, exceptId: string): Promise<void>;
  softDelete(tx: Tx, id: string): Promise<void>;
  hasMovements(tx: Tx, id: string): Promise<boolean>;
}

export interface LotRecord {
  id: string;
  organizationId: string;
  productId: string;
  code: string;
  expiresOn: LocalDate | null;
  manufacturedOn: LocalDate | null;
  createdAt: string;
}

export interface LotRepository {
  byId(tx: Tx, id: string): Promise<LotRecord | null>;
  ofProduct(tx: Tx, productId: string): Promise<LotRecord[]>;
  ensure(tx: Tx, lot: LotRecord): Promise<LotRecord>;
}

export interface NewMove {
  id: string;
  productId: string;
  variantId: string | null;
  warehouseId: string;
  lotId: string | null;
  kind: MoveKind;
  moveDate: LocalDate;
  quantity: string;
  unitCost: string;
  totalCost: string;
  balanceAfter: string;
  averageAfter: string;
  sourceType: string;
  sourceId: string | null;
  notes: string | null;
}

export interface MoveRow {
  id: string;
  moveDate: LocalDate;
  movedAt: string;
  kind: MoveKind;
  productId: string;
  productName: string;
  sku: string | null;
  warehouseId: string;
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

export interface StockLevelRow {
  productId: string;
  productName: string;
  sku: string | null;
  warehouseId: string;
  warehouseName: string;
  quantity: string;
  reserved: string;
  available: string;
  averageCost: string;
  value: string;
  minStock: string | null;
}

export interface MoveRepository {
  list(tx: Tx, query: ListQuery): Promise<ListResult<Record<string, unknown>>>;
  /**
   * Estado actual de un producto en una bodega, BLOQUEANDO la fila.
   *
   * El bloqueo es lo que hace correcto el promedio ponderado: dos entradas
   * simultáneas que leyeran el mismo promedio calcularían las dos el suyo
   * partiendo del saldo viejo, y la segunda pisaría a la primera.
   */
  stateFor(tx: Tx, productId: string, warehouseId: string): Promise<StockState>;
  insert(tx: Tx, organizationId: string, move: NewMove, createdBy: string | null): Promise<void>;
  kardex(
    tx: Tx,
    productId: string,
    warehouseId: string | null,
    from: LocalDate,
    to: LocalDate,
    limit: number,
  ): Promise<MoveRow[]>;
  bySource(tx: Tx, sourceType: string, sourceId: string): Promise<MoveRow[]>;
  /** Recalcula el nivel en caché desde los movimientos. */
  refreshLevel(tx: Tx, organizationId: string, productId: string, warehouseId: string): Promise<void>;
  levels(tx: Tx, query: ListQuery): Promise<ListResult<Record<string, unknown>>>;
  levelOf(tx: Tx, productId: string, warehouseId: string): Promise<{ quantity: Decimal; reserved: Decimal }>;
  /** Total valorizado, para el widget y para cuadrar con la contabilidad. */
  totalValue(tx: Tx): Promise<string>;
}

export interface CountRecord {
  id: string;
  organizationId: string;
  number: string | null;
  warehouseId: string;
  warehouseName: string;
  status: 'DRAFT' | 'COUNTING' | 'APPLIED' | 'CANCELLED';
  countDate: LocalDate;
  notes: string | null;
  appliedAt: string | null;
}

export interface CountLineRecord {
  id: string;
  countId: string;
  productId: string;
  productName: string;
  sku: string | null;
  lotId: string | null;
  expected: string;
  counted: string | null;
  difference: string | null;
  notes: string | null;
}

export interface CountRepository {
  list(tx: Tx, query: ListQuery): Promise<ListResult<Record<string, unknown>>>;
  byId(tx: Tx, id: string): Promise<CountRecord | null>;
  linesOf(tx: Tx, countId: string): Promise<CountLineRecord[]>;
  create(tx: Tx, count: CountRecord, createdBy: string | null): Promise<void>;
  /** Congela lo que dice el sistema al abrir el conteo. */
  seedLines(tx: Tx, organizationId: string, countId: string, warehouseId: string): Promise<number>;
  setCounted(tx: Tx, lineId: string, counted: string | null, notes: string | null): Promise<void>;
  markApplied(tx: Tx, id: string, number: string, appliedBy: string | null): Promise<void>;
  setStatus(tx: Tx, id: string, status: CountRecord['status']): Promise<void>;
}

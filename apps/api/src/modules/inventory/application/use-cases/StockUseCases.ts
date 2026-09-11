import { AppError, Decimal, newId, type Clock, type LocalDate } from '@erp/core';
import type { ListQuery } from '@erp/contracts';
import type { Tx } from '../../../../platform/db/unitOfWork.js';
import type { RequestContext } from '../../../../platform/authz/RequestContext.js';
import { actorMembershipId } from '../../../../platform/authz/RequestContext.js';
import type { AuditRecorder } from '../../../../platform/audit/AuditRecorder.js';
import { assertCan } from '../../../../platform/authz/scope.js';
import type { ListResult } from '../../../../platform/http/list.js';
import {
  applyCount,
  applyIssue,
  applyReceipt,
  assertEnoughStock,
  COST_DECIMALS,
  presentQuantity,
  QTY_DECIMALS,
  type CostedMove,
} from '../../domain/Costing.js';
import {
  assertLotBelongs,
  assertLotNotExpired,
  assertTracksInventory,
  isOutbound,
  MOVE_LABEL,
  type MoveKind,
} from '../../domain/StockMove.js';
import type {
  LotRepository,
  MoveRepository,
  MoveRow,
  WarehouseRepository,
} from '../ports/InventoryRepositories.js';

/** Lo que el módulo necesita saber de un producto. No conoce `catalog`. */
export interface ProductForStock {
  id: string;
  name: string;
  kind: string;
  sku: string | null;
  trackInventory: boolean;
  tracking: 'NONE' | 'LOT' | 'SERIAL';
  standardCost: string;
}

export interface ProductReader {
  forStock(tx: Tx, ids: readonly string[]): Promise<Map<string, ProductForStock>>;
}

export interface MoveRequest {
  productId: string;
  warehouseId?: string | null;
  lotId?: string | null;
  quantity: string;
  unitCost?: string;
  kind: MoveKind;
  moveDate?: LocalDate;
  sourceType?: string;
  sourceId?: string | null;
  notes?: string | null;
  /**
   * Permite dejar el saldo en negativo.
   *
   * Lo usan las ventas: bloquear una factura porque el inventario dice cero
   * cuando la mercancía está en el mostrador es peor que registrar un saldo
   * negativo, que además es la señal de que hay algo sin registrar.
   */
  allowNegative?: boolean;
}

export interface AppliedMove {
  id: string;
  productId: string;
  warehouseId: string;
  kind: MoveKind;
  quantity: string;
  unitCost: string;
  totalCost: string;
  balanceAfter: string;
  averageAfter: string;
}

/**
 * El libro de movimientos.
 *
 * Todo lo que entra o sale del inventario pasa por aquí, venga de una
 * recepción, de una venta o de un ajuste. Concentrarlo es lo que garantiza que
 * el costo promedio se calcule igual en todos los casos: con tres sitios que
 * escriban movimientos, tarde o temprano uno de los tres lo calcula distinto y
 * el costo de ventas depende de por dónde entró la operación.
 */
export class StockUseCases {
  constructor(
    private readonly moves: MoveRepository,
    private readonly warehouses: WarehouseRepository,
    private readonly lots: LotRepository,
    private readonly products: () => ProductReader,
    private readonly audit: AuditRecorder,
    private readonly clock: Clock,
  ) {}

  async listMoves(
    ctx: RequestContext,
    tx: Tx,
    query: ListQuery,
  ): Promise<ListResult<Record<string, unknown>>> {
    assertCan(ctx, 'inventory:move:read');
    return this.moves.list(tx, query);
  }

  async levels(
    ctx: RequestContext,
    tx: Tx,
    query: ListQuery,
  ): Promise<ListResult<Record<string, unknown>>> {
    assertCan(ctx, 'inventory:stock:read');
    return this.moves.levels(tx, query);
  }

  /** Movimientos que generó un documento. Para el enlace y para revertirlo. */
  async movesForSource(
    ctx: RequestContext,
    tx: Tx,
    sourceType: string,
    sourceId: string,
  ): Promise<MoveRow[]> {
    assertCan(ctx, 'inventory:move:read');
    return this.moves.bySource(tx, sourceType, sourceId);
  }

  async kardex(
    ctx: RequestContext,
    tx: Tx,
    productId: string,
    warehouseId: string | null,
    from: LocalDate,
    to: LocalDate,
  ): Promise<MoveRow[]> {
    assertCan(ctx, 'inventory:move:read');
    return this.moves.kardex(tx, productId, warehouseId, from, to, 2000);
  }

  /**
   * Registra un movimiento y actualiza el costo.
   *
   * Es el único camino: todo pasa por aquí. El orden importa —bloquear, costear,
   * insertar, refrescar— y saltárselo en algún sitio rompería el promedio bajo
   * concurrencia sin dar ningún error.
   */
  async move(ctx: RequestContext, tx: Tx, request: MoveRequest): Promise<AppliedMove> {
    const warehouse = await this.resolveWarehouse(tx, request.warehouseId);
    const product = (await this.products().forStock(tx, [request.productId])).get(request.productId);
    if (!product) throw AppError.notFound('Producto');
    assertTracksInventory(product);

    const today = this.today();
    const lot = request.lotId ? await this.lots.byId(tx, request.lotId) : null;
    if (request.lotId && !lot) throw AppError.notFound('Lote');
    assertLotBelongs(lot, product.id, product.tracking === 'LOT', product.name);
    if (isOutbound(request.kind)) assertLotNotExpired(lot, today);

    // Bloquea la fila: dos movimientos simultáneos del mismo producto en la
    // misma bodega se serializan aquí, no compiten por el promedio.
    const state = await this.moves.stateFor(tx, product.id, warehouse);
    const quantity = new Decimal(request.quantity);

    let costed: CostedMove;
    if (quantity.isPositive()) {
      // Sin costo declarado se usa el promedio vigente, y si no hay ninguno, el
      // costo estándar del producto. Dejarlo en cero metería mercancía gratis
      // en la bodega y hundiría el costo promedio sin que nada fallara.
      const cost =
        request.unitCost ??
        (state.averageCost.greaterThan(0) ? state.averageCost.toFixed(COST_DECIMALS) : product.standardCost);
      costed = applyReceipt(state, quantity, cost);
    } else {
      if (!request.allowNegative) {
        const level = await this.moves.levelOf(tx, product.id, warehouse);
        assertEnoughStock(level, quantity.abs(), product.name, false);
      }
      costed = applyIssue(state, quantity.abs());
    }

    return this.write(ctx, tx, {
      product,
      warehouseId: warehouse,
      lotId: lot?.id ?? null,
      kind: request.kind,
      moveDate: request.moveDate ?? today,
      costed,
      sourceType: request.sourceType ?? 'MANUAL',
      sourceId: request.sourceId ?? null,
      notes: request.notes ?? null,
    });
  }

  /** Ajuste manual: lleva las existencias a la cantidad indicada. */
  async adjust(
    ctx: RequestContext,
    tx: Tx,
    input: { productId: string; warehouseId?: string | null; counted: string; reason: string },
  ): Promise<AppliedMove | null> {
    assertCan(ctx, 'inventory:move:adjust');
    const motivo = input.reason.trim();
    if (!motivo) throw AppError.validation('Un ajuste de inventario exige un motivo');

    const warehouse = await this.resolveWarehouse(tx, input.warehouseId);
    const product = (await this.products().forStock(tx, [input.productId])).get(input.productId);
    if (!product) throw AppError.notFound('Producto');
    assertTracksInventory(product);

    const state = await this.moves.stateFor(tx, product.id, warehouse);
    const costed = applyCount(state, input.counted);
    // Sin diferencia no hay movimiento: un ajuste de cero ensucia el kardex y
    // hace creer que algo pasó.
    if (!costed) return null;

    return this.write(ctx, tx, {
      product,
      warehouseId: warehouse,
      lotId: null,
      kind: 'ADJUSTMENT',
      moveDate: this.today(),
      costed,
      sourceType: 'MANUAL',
      sourceId: null,
      notes: motivo,
    });
  }

  /** Escribe el movimiento, refresca la caché de saldos y deja rastro. */
  private async write(
    ctx: RequestContext,
    tx: Tx,
    input: {
      product: ProductForStock;
      warehouseId: string;
      lotId: string | null;
      kind: MoveKind;
      moveDate: LocalDate;
      costed: CostedMove;
      sourceType: string;
      sourceId: string | null;
      notes: string | null;
    },
  ): Promise<AppliedMove> {
    const id = newId();
    const move = {
      id,
      productId: input.product.id,
      variantId: null,
      warehouseId: input.warehouseId,
      lotId: input.lotId,
      kind: input.kind,
      moveDate: input.moveDate,
      quantity: input.costed.quantity.toFixed(QTY_DECIMALS),
      unitCost: input.costed.unitCost.toFixed(COST_DECIMALS),
      totalCost: input.costed.totalCost.toFixed(COST_DECIMALS),
      balanceAfter: input.costed.balanceAfter.toFixed(QTY_DECIMALS),
      averageAfter: input.costed.averageAfter.toFixed(COST_DECIMALS),
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      notes: input.notes,
    };

    await this.moves.insert(tx, ctx.organizationId, move, actorMembershipId(ctx));
    await this.moves.refreshLevel(tx, ctx.organizationId, input.product.id, input.warehouseId);

    await this.audit.record(tx, ctx, {
      action: 'CREATE',
      entityType: 'stock_move',
      entityId: id,
      entityLabel: `${MOVE_LABEL[input.kind]} · ${input.product.name}`,
      after: {
        cantidad: move.quantity,
        costoUnitario: move.unitCost,
        saldo: move.balanceAfter,
        promedio: move.averageAfter,
        motivo: input.notes,
      },
    });

    // Las cantidades se devuelven como se presentan; los importes, con su
    // escala contable. Son dos cosas distintas y se formatean distinto.
    return {
      id,
      productId: input.product.id,
      warehouseId: input.warehouseId,
      kind: input.kind,
      quantity: presentQuantity(input.costed.quantity),
      unitCost: move.unitCost,
      totalCost: move.totalCost,
      balanceAfter: presentQuantity(input.costed.balanceAfter),
      averageAfter: move.averageAfter,
    };
  }

  /** La bodega indicada, o la de por defecto. Sin ninguna, no hay inventario. */
  private async resolveWarehouse(tx: Tx, warehouseId?: string | null): Promise<string> {
    if (warehouseId) {
      const warehouse = await this.warehouses.byId(tx, warehouseId);
      if (!warehouse) throw AppError.notFound('Bodega');
      if (!warehouse.isActive) throw AppError.rule(`La bodega ${warehouse.name} está inactiva`);
      return warehouse.id;
    }
    const fallback = await this.warehouses.defaultOne(tx);
    if (!fallback) {
      throw AppError.rule(
        'No hay ninguna bodega configurada. Crea una en Inventario → Bodegas antes de mover existencias.',
      );
    }
    return fallback.id;
  }

  today(): LocalDate {
    return this.clock.now().toISOString().slice(0, 10);
  }

  async totalValue(ctx: RequestContext, tx: Tx): Promise<string> {
    assertCan(ctx, 'inventory:stock:read');
    return this.moves.totalValue(tx);
  }
}

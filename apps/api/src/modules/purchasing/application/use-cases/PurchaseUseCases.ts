import {
  aggregateDocumentTotals,
  AppError,
  computeLineTotals,
  Decimal,
  Money,
  newId,
  type Clock,
  type LocalDate,
  type TaxDef,
} from '@erp/core';
import type { ListQuery } from '@erp/contracts';
import type { Tx } from '../../../../platform/db/unitOfWork.js';
import type { RequestContext } from '../../../../platform/authz/RequestContext.js';
import { actorMembershipId } from '../../../../platform/authz/RequestContext.js';
import type { AuditRecorder } from '../../../../platform/audit/AuditRecorder.js';
import type { EventBus } from '../../../../platform/events/EventBus.js';
import type { SequenceAllocator } from '../../../../platform/numbering/SequenceAllocator.js';
import { assertCan, scopeFilter } from '../../../../platform/authz/scope.js';
import type { ListResult } from '../../../../platform/http/list.js';
import {
  assertWithinOrder,
  deriveOrderStatus,
  threeWayMatch,
  type ThreeWayMatch,
} from '../../domain/Purchasing.js';
import type {
  OrderLine,
  PurchaseOrder,
  PurchaseOrderRepository,
  PurchasingOverview,
  ReceiptRepository,
} from '../ports/PurchasingRepositories.js';

/** Escala de los importes en la base y, por tanto, en la API. */
const DB_DECIMALS = 4;

/** Lo que compras necesita del catálogo. No importa nada de `catalog`. */
export interface ProductForPurchase {
  id: string;
  sku: string | null;
  name: string;
  purchasePrice: string;
  currencyCode: string;
  uomCode: string;
  purchaseTax: TaxDef | null;
  trackInventory: boolean;
}

export interface PurchaseCatalogReader {
  forPurchase(tx: Tx, ids: readonly string[]): Promise<Map<string, ProductForPurchase>>;
}

export interface OrderLineInput {
  productId?: string | null;
  description?: string;
  quantity: string;
  unitPrice?: string;
  discountPercent?: string;
  taxId?: string | null;
}

export interface OrderInput {
  partyId: string;
  warehouseId?: string | null;
  orderDate?: LocalDate;
  expectedDate?: LocalDate | null;
  currencyCode?: string;
  notes?: string | null;
  terms?: string | null;
  lines: readonly OrderLineInput[];
}

export interface OrderDetail {
  order: PurchaseOrder;
  partyName: string;
  lines: OrderLine[];
  receipts: Array<{ id: string; number: string | null; receiptDate: LocalDate; status: string }>;
  /** Contraste pedido/recibido/facturado, línea a línea. */
  match: Array<ThreeWayMatch & { description: string }>;
}

/**
 * Órdenes de compra.
 *
 * Una orden NO mueve inventario ni genera obligación de pago: es una intención.
 * Lo que llega se registra con una recepción y lo que cobran con una factura.
 * Esa separación es lo que permite ver que llegaron ocho de las diez pedidas
 * mientras facturan diez.
 */
export class PurchaseOrderUseCases {
  constructor(
    private readonly orders: PurchaseOrderRepository,
    private readonly receipts: ReceiptRepository,
    private readonly catalog: () => PurchaseCatalogReader,
    private readonly sequences: SequenceAllocator,
    private readonly audit: AuditRecorder,
    private readonly events: EventBus,
    private readonly clock: Clock,
  ) {}

  async list(ctx: RequestContext, tx: Tx, query: ListQuery): Promise<ListResult<Record<string, unknown>>> {
    assertCan(ctx, 'purchasing:order:read');
    void scopeFilter(ctx, 'purchasing:order:read');
    return this.orders.list(tx, query);
  }

  async get(ctx: RequestContext, tx: Tx, id: string): Promise<OrderDetail> {
    assertCan(ctx, 'purchasing:order:read');
    const order = await this.orders.byId(tx, id);
    if (!order) throw AppError.notFound('Orden de compra');

    const lines = await this.orders.linesOf(tx, id);
    const receipts = await this.receipts.ofOrder(tx, id);

    return {
      order: { ...order, status: deriveOrderStatus(order.status, lines) },
      partyName: await this.orders.partyNameOf(tx, order.partyId),
      lines,
      receipts: receipts.map((r) => ({
        id: r.id,
        number: r.number,
        receiptDate: r.receiptDate,
        status: r.status,
      })),
      // Sin facturas todavía no hay tercera vía; el contraste completo lo
      // calcula la factura al registrarse contra esta orden.
      match: lines.map((line) => ({
        ...threeWayMatch({
          ordered: line.quantity,
          received: line.received,
          billed: line.received,
          description: line.description,
        }),
        description: line.description,
      })),
    };
  }

  async create(ctx: RequestContext, tx: Tx, input: OrderInput): Promise<OrderDetail> {
    assertCan(ctx, 'purchasing:order:create');
    const id = newId();
    const built = await this.build(tx, input);

    const order: PurchaseOrder = {
      id,
      organizationId: ctx.organizationId,
      number: null,
      partyId: input.partyId,
      warehouseId: input.warehouseId ?? null,
      status: 'DRAFT',
      orderDate: input.orderDate ?? this.today(),
      expectedDate: input.expectedDate ?? null,
      currencyCode: built.currency,
      exchangeRate: '1',
      subtotal: built.totals.subtotal.toDb(DB_DECIMALS),
      taxTotal: built.totals.taxTotal.toDb(DB_DECIMALS),
      total: built.totals.total.toDb(DB_DECIMALS),
      notes: input.notes ?? null,
      terms: input.terms ?? null,
      ownerMembershipId: ctx.membershipId,
      branchId: ctx.branchId,
    };

    await this.orders.save(tx, order, actorMembershipId(ctx));
    await this.orders.replaceLines(tx, ctx.organizationId, id, built.lines);

    await this.audit.record(tx, ctx, {
      action: 'CREATE',
      entityType: 'purchase_order',
      entityId: id,
      entityLabel: `Borrador · ${order.total} ${order.currencyCode}`,
      after: { proveedor: input.partyId, total: order.total, lineas: built.lines.length },
    });

    return this.get(ctx, tx, id);
  }

  async update(ctx: RequestContext, tx: Tx, id: string, input: OrderInput): Promise<OrderDetail> {
    assertCan(ctx, 'purchasing:order:update');
    const before = await this.requireOrder(tx, id);
    this.assertEditable(before);

    const built = await this.build(tx, input);
    await this.orders.update(tx, {
      ...before,
      partyId: input.partyId,
      warehouseId: input.warehouseId ?? before.warehouseId,
      orderDate: input.orderDate ?? before.orderDate,
      expectedDate: input.expectedDate !== undefined ? input.expectedDate : before.expectedDate,
      currencyCode: built.currency,
      subtotal: built.totals.subtotal.toDb(DB_DECIMALS),
      taxTotal: built.totals.taxTotal.toDb(DB_DECIMALS),
      total: built.totals.total.toDb(DB_DECIMALS),
      notes: input.notes !== undefined ? input.notes : before.notes,
      terms: input.terms !== undefined ? input.terms : before.terms,
    });
    await this.orders.replaceLines(tx, ctx.organizationId, id, built.lines);

    await this.audit.record(tx, ctx, {
      action: 'UPDATE',
      entityType: 'purchase_order',
      entityId: id,
      entityLabel: before.number ?? 'Borrador',
      before: { total: before.total },
      after: { total: built.totals.total.toDb(DB_DECIMALS) },
    });
    return this.get(ctx, tx, id);
  }

  /** Enviarla al proveedor le asigna el consecutivo y la vuelve reclamable. */
  async send(ctx: RequestContext, tx: Tx, id: string): Promise<OrderDetail> {
    assertCan(ctx, 'purchasing:order:send');
    const order = await this.requireOrder(tx, id);
    if (order.status !== 'DRAFT') throw AppError.rule(`La orden ${order.number} ya fue enviada`);

    const lines = await this.orders.linesOf(tx, id);
    if (lines.length === 0) throw AppError.rule('No se puede enviar una orden sin líneas');

    const allocated = await this.sequences.next(
      tx,
      { organizationId: ctx.organizationId, docType: 'purchase_order', branchId: order.branchId },
      new Date(`${order.orderDate}T00:00:00Z`),
    );

    await this.orders.update(tx, { ...order, number: allocated.formatted, status: 'SENT' });
    await this.audit.record(tx, ctx, {
      action: 'UPDATE',
      entityType: 'purchase_order',
      entityId: id,
      entityLabel: allocated.formatted,
      before: { estado: 'DRAFT' },
      after: { estado: 'SENT', numero: allocated.formatted },
    });

    await this.events.publish(tx, {
      type: 'purchase_order.sent',
      aggregateType: 'purchase_order',
      aggregateId: id,
      organizationId: ctx.organizationId,
      payload: { number: allocated.formatted, partyId: order.partyId, total: order.total },
      actorMembershipId: ctx.membershipId,
    });

    return this.get(ctx, tx, id);
  }

  async cancel(ctx: RequestContext, tx: Tx, id: string, reason: string): Promise<OrderDetail> {
    assertCan(ctx, 'purchasing:order:update');
    const order = await this.requireOrder(tx, id);
    const motivo = reason.trim();
    if (!motivo) throw AppError.validation('Cancelar una orden exige un motivo');

    const lines = await this.orders.linesOf(tx, id);
    const received = lines.reduce((a, l) => a.plus(l.received), new Decimal(0));
    if (received.greaterThan(0)) {
      throw AppError.rule(
        'Esta orden ya tiene mercancía recibida y no se puede cancelar. ' +
          'Devuélvela al proveedor o cierra la orden con lo que llegó.',
      );
    }

    await this.orders.setStatus(tx, id, 'CANCELLED');
    await this.audit.record(tx, ctx, {
      action: 'UPDATE',
      entityType: 'purchase_order',
      entityId: id,
      entityLabel: order.number ?? 'Borrador',
      before: { estado: order.status },
      after: { estado: 'CANCELLED', motivo },
    });
    return this.get(ctx, tx, id);
  }

  async remove(ctx: RequestContext, tx: Tx, id: string): Promise<void> {
    assertCan(ctx, 'purchasing:order:delete');
    const order = await this.requireOrder(tx, id);
    if (order.status !== 'DRAFT') {
      throw AppError.rule(
        `La orden ${order.number} ya fue enviada al proveedor: cancélala en vez de borrarla`,
      );
    }
    await this.orders.softDelete(tx, id);
    await this.audit.record(tx, ctx, {
      action: 'DELETE',
      entityType: 'purchase_order',
      entityId: id,
      entityLabel: 'Borrador',
      before: { total: order.total },
    });
  }

  async overview(ctx: RequestContext, tx: Tx): Promise<PurchasingOverview> {
    assertCan(ctx, 'purchasing:order:read');
    return this.orders.overview(tx, this.today());
  }

  /** Comprueba que una recepción cabe en la orden, y actualiza su estado. */
  async assertReceivable(
    tx: Tx,
    orderId: string,
    incoming: ReadonlyArray<{ orderLineId: string | null; quantity: string }>,
  ): Promise<void> {
    const lines = await this.orders.linesOf(tx, orderId);
    const byId = new Map(lines.map((l) => [l.id, l]));
    for (const item of incoming) {
      if (!item.orderLineId) continue;
      const line = byId.get(item.orderLineId);
      if (!line) continue;
      assertWithinOrder(line, item.quantity, line.description);
    }
  }

  async refreshFromReceipts(tx: Tx, orderId: string): Promise<void> {
    await this.orders.recalculateReceived(tx, orderId);
    const order = await this.orders.byId(tx, orderId);
    if (!order) return;
    const lines = await this.orders.linesOf(tx, orderId);
    const derived = deriveOrderStatus(order.status, lines);
    if (derived !== order.status) await this.orders.setStatus(tx, orderId, derived);
  }

  private assertEditable(order: PurchaseOrder): void {
    if (order.status === 'CANCELLED') throw AppError.rule('Una orden cancelada no se edita');
    if (order.status === 'RECEIVED') {
      throw AppError.rule('Esta orden ya se recibió completa y no se puede editar');
    }
  }

  private async requireOrder(tx: Tx, id: string): Promise<PurchaseOrder> {
    const order = await this.orders.byId(tx, id);
    if (!order) throw AppError.notFound('Orden de compra');
    return order;
  }

  /**
   * Arma las líneas con sus impuestos.
   *
   * El precio y la tarifa se COPIAN del catálogo al crear la línea, no se leen
   * después: si se leyeran, cambiar el precio de compra de un proveedor
   * reescribiría órdenes ya enviadas.
   */
  private async build(
    tx: Tx,
    input: OrderInput,
  ): Promise<{
    currency: string;
    lines: Omit<OrderLine, 'id' | 'received' | 'pending'>[];
    totals: ReturnType<typeof aggregateDocumentTotals>;
  }> {
    if (input.lines.length === 0) throw AppError.validation('Una orden necesita al menos una línea');

    const ids = input.lines.map((l) => l.productId).filter((id): id is string => !!id);
    const products = await this.catalog().forPurchase(tx, ids);
    const currency = input.currencyCode ?? 'COP';

    const computed = input.lines.map((line, index) => {
      const product = line.productId ? products.get(line.productId) : undefined;
      if (line.productId && !product) throw AppError.validation(`El producto de la línea ${index + 1} no existe`);

      const description = line.description?.trim() || product?.name;
      if (!description) {
        throw AppError.validation(`La línea ${index + 1} necesita un producto o una descripción`);
      }

      const unitPrice = line.unitPrice ?? product?.purchasePrice ?? '0';
      const taxes = product?.purchaseTax ? [product.purchaseTax] : [];

      const totals = computeLineTotals({
        quantity: line.quantity,
        unitPrice,
        discountPercent: line.discountPercent ?? '0',
        taxes,
        currency,
      });

      return {
        position: index + 1,
        productId: line.productId ?? null,
        description,
        sku: product?.sku ?? null,
        uomCode: product?.uomCode ?? null,
        quantity: new Decimal(line.quantity).toFixed(6),
        unitPrice: Money.of(unitPrice, currency).toDb(DB_DECIMALS),
        discountPercent: new Decimal(line.discountPercent ?? 0).toFixed(6),
        taxId: line.taxId ?? product?.purchaseTax?.id ?? null,
        subtotal: totals.subtotal.toDb(DB_DECIMALS),
        taxTotal: totals.taxTotal.toDb(DB_DECIMALS),
        total: totals.total.toDb(DB_DECIMALS),
        totals,
      };
    });

    return {
      currency,
      lines: computed.map(({ totals, ...line }) => {
        void totals;
        return line;
      }),
      totals: aggregateDocumentTotals(
        computed.map((c) => c.totals),
        currency,
      ),
    };
  }

  today(): LocalDate {
    return this.clock.now().toISOString().slice(0, 10);
  }
}

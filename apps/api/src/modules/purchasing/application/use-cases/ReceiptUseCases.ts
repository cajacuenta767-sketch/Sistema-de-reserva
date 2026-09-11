import { AppError, newId, type Clock, type LocalDate } from '@erp/core';
import type { ListQuery } from '@erp/contracts';
import type { Tx } from '../../../../platform/db/unitOfWork.js';
import type { RequestContext } from '../../../../platform/authz/RequestContext.js';
import { actorMembershipId } from '../../../../platform/authz/RequestContext.js';
import type { AuditRecorder } from '../../../../platform/audit/AuditRecorder.js';
import type { EventBus } from '../../../../platform/events/EventBus.js';
import type { SequenceAllocator } from '../../../../platform/numbering/SequenceAllocator.js';
import { assertCan } from '../../../../platform/authz/scope.js';
import type { ListResult } from '../../../../platform/http/list.js';
import type {
  GoodsReceipt,
  ReceiptLine,
  ReceiptRepository,
} from '../ports/PurchasingRepositories.js';
import type { PurchaseOrderUseCases } from './PurchaseUseCases.js';

export interface ReceiptLineInput {
  orderLineId?: string | null;
  productId: string;
  lotId?: string | null;
  description?: string;
  quantity: string;
  unitCost?: string;
}

export interface ReceiptInput {
  partyId: string;
  orderId?: string | null;
  warehouseId: string;
  receiptDate?: LocalDate;
  reference?: string | null;
  notes?: string | null;
  lines: readonly ReceiptLineInput[];
}

export interface ReceiptDetail {
  receipt: GoodsReceipt;
  lines: ReceiptLine[];
}

/**
 * Recepciones de mercancía.
 *
 * Es el documento que mueve el inventario: ni la orden ni la factura lo hacen.
 * Una orden es una intención y una factura es un cobro; solo la recepción es un
 * hecho físico, y por eso es la única que cambia lo que hay en la bodega.
 */
export class ReceiptUseCases {
  constructor(
    private readonly receipts: ReceiptRepository,
    private readonly orders: PurchaseOrderUseCases,
    private readonly sequences: SequenceAllocator,
    private readonly audit: AuditRecorder,
    private readonly events: EventBus,
    private readonly clock: Clock,
  ) {}

  async list(ctx: RequestContext, tx: Tx, query: ListQuery): Promise<ListResult<Record<string, unknown>>> {
    assertCan(ctx, 'purchasing:receipt:read');
    return this.receipts.list(tx, query);
  }

  async get(ctx: RequestContext, tx: Tx, id: string): Promise<ReceiptDetail> {
    assertCan(ctx, 'purchasing:receipt:read');
    const receipt = await this.receipts.byId(tx, id);
    if (!receipt) throw AppError.notFound('Recepción');
    return { receipt, lines: await this.receipts.linesOf(tx, id) };
  }

  async create(ctx: RequestContext, tx: Tx, input: ReceiptInput): Promise<ReceiptDetail> {
    assertCan(ctx, 'purchasing:receipt:create');
    if (input.lines.length === 0) {
      throw AppError.validation('Una recepción necesita al menos una línea');
    }

    // Lo que llega tiene que caber en lo que se pidió, con la tolerancia de
    // empaque. Se comprueba ANTES de escribir nada.
    if (input.orderId) {
      await this.orders.assertReceivable(
        tx,
        input.orderId,
        input.lines.map((l) => ({ orderLineId: l.orderLineId ?? null, quantity: l.quantity })),
      );
    }

    const id = newId();
    const receipt: GoodsReceipt = {
      id,
      organizationId: ctx.organizationId,
      number: null,
      partyId: input.partyId,
      orderId: input.orderId ?? null,
      warehouseId: input.warehouseId,
      status: 'DRAFT',
      receiptDate: input.receiptDate ?? this.today(),
      reference: input.reference ?? null,
      notes: input.notes ?? null,
    };

    await this.receipts.save(tx, receipt, actorMembershipId(ctx));
    await this.receipts.replaceLines(
      tx,
      ctx.organizationId,
      id,
      input.lines.map((line, index) => ({
        position: index + 1,
        orderLineId: line.orderLineId ?? null,
        productId: line.productId,
        lotId: line.lotId ?? null,
        description: line.description?.trim() || 'Mercancía recibida',
        quantity: line.quantity,
        unitCost: line.unitCost ?? '0',
      })),
    );

    await this.audit.record(tx, ctx, {
      action: 'CREATE',
      entityType: 'goods_receipt',
      entityId: id,
      entityLabel: 'Borrador de recepción',
      after: { proveedor: input.partyId, lineas: input.lines.length, guia: receipt.reference },
    });

    return this.get(ctx, tx, id);
  }

  /**
   * Contabiliza la recepción: le asigna número y mueve el inventario.
   *
   * El movimiento lo hace el módulo de inventario al oír `goods_receipt.posted`,
   * de forma transaccional: si el inventario falla, la recepción no se
   * contabiliza. Compras no sabe cómo se calcula un costo promedio, y no tiene
   * por qué.
   */
  async post(ctx: RequestContext, tx: Tx, id: string): Promise<ReceiptDetail> {
    assertCan(ctx, 'purchasing:receipt:post');
    const receipt = await this.requireReceipt(tx, id);
    if (receipt.status === 'POSTED') {
      throw AppError.rule(`La recepción ${receipt.number} ya está contabilizada`);
    }
    if (receipt.status === 'VOID') throw AppError.rule('Una recepción anulada no se contabiliza');

    const lines = await this.receipts.linesOf(tx, id);
    if (lines.length === 0) throw AppError.rule('No se puede contabilizar una recepción sin líneas');

    const allocated = await this.sequences.next(
      tx,
      { organizationId: ctx.organizationId, docType: 'goods_receipt' },
      new Date(`${receipt.receiptDate}T00:00:00Z`),
    );
    await this.receipts.post(tx, id, allocated.formatted);

    await this.events.publish(tx, {
      type: 'goods_receipt.posted',
      aggregateType: 'goods_receipt',
      aggregateId: id,
      organizationId: ctx.organizationId,
      payload: {
        number: allocated.formatted,
        partyId: receipt.partyId,
        warehouseId: receipt.warehouseId,
        receiptDate: receipt.receiptDate,
        lines: lines.map((l) => ({
          productId: l.productId,
          lotId: l.lotId,
          quantity: l.quantity,
          unitCost: l.unitCost,
          description: l.description,
        })),
      },
      actorMembershipId: ctx.membershipId,
    });

    // Después del evento: lo recibido se recalcula desde las recepciones
    // contabilizadas, y esta acaba de serlo.
    if (receipt.orderId) await this.orders.refreshFromReceipts(tx, receipt.orderId);

    await this.audit.record(tx, ctx, {
      action: 'UPDATE',
      entityType: 'goods_receipt',
      entityId: id,
      entityLabel: allocated.formatted,
      before: { estado: 'DRAFT' },
      after: { estado: 'POSTED', numero: allocated.formatted, lineas: lines.length },
    });

    return this.get(ctx, tx, id);
  }

  /** Anular devuelve la mercancía con movimientos propios, no borrando nada. */
  async void(ctx: RequestContext, tx: Tx, id: string, reason: string): Promise<ReceiptDetail> {
    assertCan(ctx, 'purchasing:receipt:void');
    const receipt = await this.requireReceipt(tx, id);
    const motivo = reason.trim();
    if (!motivo) throw AppError.validation('Anular una recepción exige un motivo');
    if (receipt.status === 'VOID') throw AppError.rule('Esta recepción ya está anulada');

    await this.receipts.void(tx, id, motivo);

    if (receipt.status === 'POSTED') {
      await this.events.publish(tx, {
        type: 'goods_receipt.voided',
        aggregateType: 'goods_receipt',
        aggregateId: id,
        organizationId: ctx.organizationId,
        payload: { number: receipt.number, reason: motivo },
        actorMembershipId: ctx.membershipId,
      });
      if (receipt.orderId) await this.orders.refreshFromReceipts(tx, receipt.orderId);
    }

    await this.audit.record(tx, ctx, {
      action: 'UPDATE',
      entityType: 'goods_receipt',
      entityId: id,
      entityLabel: receipt.number ?? 'Borrador',
      before: { estado: receipt.status },
      after: { estado: 'VOID', motivo },
    });
    return this.get(ctx, tx, id);
  }

  private async requireReceipt(tx: Tx, id: string): Promise<GoodsReceipt> {
    const receipt = await this.receipts.byId(tx, id);
    if (!receipt) throw AppError.notFound('Recepción');
    return receipt;
  }

  private today(): LocalDate {
    return this.clock.now().toISOString().slice(0, 10);
  }
}

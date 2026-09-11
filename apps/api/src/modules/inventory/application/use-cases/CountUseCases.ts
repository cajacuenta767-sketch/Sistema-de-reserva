import { AppError, Decimal, newId, type Clock, type LocalDate } from '@erp/core';
import type { ListQuery } from '@erp/contracts';
import type { Tx } from '../../../../platform/db/unitOfWork.js';
import type { RequestContext } from '../../../../platform/authz/RequestContext.js';
import { actorMembershipId } from '../../../../platform/authz/RequestContext.js';
import type { AuditRecorder } from '../../../../platform/audit/AuditRecorder.js';
import type { SequenceAllocator } from '../../../../platform/numbering/SequenceAllocator.js';
import { assertCan } from '../../../../platform/authz/scope.js';
import type { ListResult } from '../../../../platform/http/list.js';
import type {
  CountLineRecord,
  CountRecord,
  CountRepository,
  WarehouseRepository,
} from '../ports/InventoryRepositories.js';
import type { StockUseCases } from './StockUseCases.js';

export interface CountDetail {
  count: CountRecord;
  lines: CountLineRecord[];
  summary: {
    lines: number;
    counted: number;
    pending: number;
    withDifference: number;
    netDifference: string;
  };
}

/**
 * Conteo físico.
 *
 * El valor está en congelar lo que decía el sistema AL ABRIR el conteo. Si se
 * leyera al aplicar, una venta hecha mientras se cuenta cambiaría la diferencia
 * y el ajuste taparía ese movimiento en vez de reflejar lo contado: el
 * inventario cuadraría y el descuadre real seguiría ahí, invisible.
 */
export class CountUseCases {
  constructor(
    private readonly counts: CountRepository,
    private readonly warehouses: WarehouseRepository,
    private readonly stock: StockUseCases,
    private readonly sequences: SequenceAllocator,
    private readonly audit: AuditRecorder,
    private readonly clock: Clock,
  ) {}

  async list(ctx: RequestContext, tx: Tx, query: ListQuery): Promise<ListResult<Record<string, unknown>>> {
    assertCan(ctx, 'inventory:count:read');
    return this.counts.list(tx, query);
  }

  async get(ctx: RequestContext, tx: Tx, id: string): Promise<CountDetail> {
    assertCan(ctx, 'inventory:count:read');
    const count = await this.counts.byId(tx, id);
    if (!count) throw AppError.notFound('Conteo');
    const lines = await this.counts.linesOf(tx, id);

    const counted = lines.filter((l) => l.counted !== null);
    const withDifference = counted.filter((l) => Number(l.difference ?? 0) !== 0);
    const net = counted.reduce((acc, l) => acc.plus(l.difference ?? 0), new Decimal(0));

    return {
      count,
      lines,
      summary: {
        lines: lines.length,
        counted: counted.length,
        pending: lines.length - counted.length,
        withDifference: withDifference.length,
        netDifference: net.toFixed(2),
      },
    };
  }

  /** Abre un conteo y congela las existencias de la bodega en ese instante. */
  async open(
    ctx: RequestContext,
    tx: Tx,
    input: { warehouseId: string; countDate?: LocalDate; notes?: string | null },
  ): Promise<CountDetail> {
    assertCan(ctx, 'inventory:count:create');
    const warehouse = await this.warehouses.byId(tx, input.warehouseId);
    if (!warehouse) throw AppError.notFound('Bodega');

    const count: CountRecord = {
      id: newId(),
      organizationId: ctx.organizationId,
      number: null,
      warehouseId: warehouse.id,
      warehouseName: warehouse.name,
      status: 'COUNTING',
      countDate: input.countDate ?? this.today(),
      notes: input.notes ?? null,
      appliedAt: null,
    };

    await this.counts.create(tx, count, actorMembershipId(ctx));
    const lines = await this.counts.seedLines(tx, ctx.organizationId, count.id, warehouse.id);

    await this.audit.record(tx, ctx, {
      action: 'CREATE',
      entityType: 'stock_count',
      entityId: count.id,
      entityLabel: `Conteo de ${warehouse.name}`,
      after: { bodega: warehouse.name, fecha: count.countDate, lineas: lines },
    });

    return this.get(ctx, tx, count.id);
  }

  async setCounted(
    ctx: RequestContext,
    tx: Tx,
    id: string,
    lineId: string,
    counted: string | null,
    notes?: string | null,
  ): Promise<CountDetail> {
    assertCan(ctx, 'inventory:count:update');
    const count = await this.counts.byId(tx, id);
    if (!count) throw AppError.notFound('Conteo');
    if (count.status !== 'COUNTING') {
      throw AppError.rule(
        count.status === 'APPLIED'
          ? 'Este conteo ya se aplicó: sus cifras son historia y no se editan'
          : 'Este conteo está cancelado',
      );
    }
    if (counted !== null && new Decimal(counted).isNegative()) {
      throw AppError.validation('Una cantidad contada no puede ser negativa');
    }

    await this.counts.setCounted(tx, lineId, counted, notes ?? null);
    return this.get(ctx, tx, id);
  }

  /**
   * Aplica el conteo: genera un ajuste por cada diferencia.
   *
   * Las líneas SIN contar no se tocan. Aplicarlas como cero convertiría un
   * conteo a medias en una baja masiva de inventario, que es exactamente el
   * accidente que este permiso separado existe para evitar.
   */
  async apply(ctx: RequestContext, tx: Tx, id: string): Promise<CountDetail> {
    assertCan(ctx, 'inventory:count:apply');
    const detail = await this.get(ctx, tx, id);
    if (detail.count.status !== 'COUNTING') {
      throw AppError.rule('Solo se aplica un conteo en curso');
    }
    if (detail.summary.counted === 0) {
      throw AppError.rule('Este conteo no tiene ninguna línea contada');
    }

    const allocated = await this.sequences.next(
      tx,
      { organizationId: ctx.organizationId, docType: 'stock_count' },
      new Date(`${detail.count.countDate}T00:00:00Z`),
    );

    let adjusted = 0;
    for (const line of detail.lines) {
      if (line.counted === null) continue;
      const move = await this.stock.adjust(ctx, tx, {
        productId: line.productId,
        warehouseId: detail.count.warehouseId,
        counted: line.counted,
        reason: `Conteo ${allocated.formatted} · ${detail.count.warehouseName}`,
      });
      if (move) adjusted += 1;
    }

    await this.counts.markApplied(tx, id, allocated.formatted, actorMembershipId(ctx));
    await this.audit.record(tx, ctx, {
      action: 'UPDATE',
      entityType: 'stock_count',
      entityId: id,
      entityLabel: allocated.formatted,
      before: { estado: 'en curso' },
      after: {
        estado: 'aplicado',
        ajustes: adjusted,
        sinContar: detail.summary.pending,
        diferenciaNeta: detail.summary.netDifference,
      },
    });

    return this.get(ctx, tx, id);
  }

  async cancel(ctx: RequestContext, tx: Tx, id: string): Promise<CountDetail> {
    assertCan(ctx, 'inventory:count:update');
    const count = await this.counts.byId(tx, id);
    if (!count) throw AppError.notFound('Conteo');
    if (count.status === 'APPLIED') {
      throw AppError.rule(
        'Un conteo aplicado no se cancela: sus ajustes ya están en el inventario. ' +
          'Corrígelos con otro ajuste.',
      );
    }

    await this.counts.setStatus(tx, id, 'CANCELLED');
    await this.audit.record(tx, ctx, {
      action: 'UPDATE',
      entityType: 'stock_count',
      entityId: id,
      entityLabel: count.number ?? 'Conteo',
      before: { estado: count.status },
      after: { estado: 'cancelado' },
    });
    return this.get(ctx, tx, id);
  }

  private today(): LocalDate {
    return this.clock.now().toISOString().slice(0, 10);
  }
}

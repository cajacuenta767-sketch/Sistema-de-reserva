import { AppError, newId } from '@erp/core';
import type { ListQuery } from '@erp/contracts';
import type { Tx } from '../../../../platform/db/unitOfWork.js';
import type { RequestContext } from '../../../../platform/authz/RequestContext.js';
import type { AuditRecorder } from '../../../../platform/audit/AuditRecorder.js';
import { assertCan } from '../../../../platform/authz/scope.js';
import type { ListResult } from '../../../../platform/http/list.js';
import type {
  WarehouseRecord,
  WarehouseRepository,
} from '../ports/InventoryRepositories.js';

export interface WarehouseInput {
  code: string;
  name: string;
  branchId?: string | null;
  address?: string | null;
  city?: string | null;
  isDefault?: boolean;
  isActive?: boolean;
}

export class WarehouseUseCases {
  constructor(
    private readonly warehouses: WarehouseRepository,
    private readonly audit: AuditRecorder,
  ) {}

  async list(ctx: RequestContext, tx: Tx, query: ListQuery): Promise<ListResult<Record<string, unknown>>> {
    assertCan(ctx, 'inventory:warehouse:read');
    return this.warehouses.list(tx, query);
  }

  async all(ctx: RequestContext, tx: Tx): Promise<WarehouseRecord[]> {
    assertCan(ctx, 'inventory:warehouse:read');
    return this.warehouses.all(tx);
  }

  async get(ctx: RequestContext, tx: Tx, id: string): Promise<WarehouseRecord> {
    assertCan(ctx, 'inventory:warehouse:read');
    const warehouse = await this.warehouses.byId(tx, id);
    if (!warehouse) throw AppError.notFound('Bodega');
    return warehouse;
  }

  async create(ctx: RequestContext, tx: Tx, input: WarehouseInput): Promise<WarehouseRecord> {
    assertCan(ctx, 'inventory:warehouse:create');
    const code = input.code.trim().toUpperCase();
    if (await this.warehouses.byCode(tx, code)) {
      throw AppError.conflict(`Ya existe una bodega con el código ${code}`);
    }

    // La primera bodega es la de por defecto: si no, el primer movimiento
    // fallaría pidiendo elegir una de una sola opción.
    const existing = await this.warehouses.all(tx);
    const isDefault = input.isDefault ?? existing.length === 0;

    const warehouse: WarehouseRecord = {
      id: newId(),
      organizationId: ctx.organizationId,
      code,
      name: input.name.trim(),
      branchId: input.branchId ?? null,
      address: input.address ?? null,
      city: input.city ?? null,
      isDefault,
      isActive: input.isActive ?? true,
    };

    // Quitar la marca a las demás ANTES de crear: el índice único parcial la
    // rechazaría con un error de clave duplicada que no dice nada útil.
    if (isDefault) await this.warehouses.clearDefault(tx, warehouse.id);
    await this.warehouses.create(tx, warehouse);

    await this.audit.record(tx, ctx, {
      action: 'CREATE',
      entityType: 'warehouse',
      entityId: warehouse.id,
      entityLabel: `${warehouse.code} · ${warehouse.name}`,
      after: { codigo: warehouse.code, nombre: warehouse.name, porDefecto: warehouse.isDefault },
    });
    return warehouse;
  }

  async update(
    ctx: RequestContext,
    tx: Tx,
    id: string,
    input: Partial<WarehouseInput>,
  ): Promise<WarehouseRecord> {
    assertCan(ctx, 'inventory:warehouse:update');
    const before = await this.get(ctx, tx, id);

    if (input.code !== undefined && input.code.trim().toUpperCase() !== before.code) {
      throw AppError.rule('El código de una bodega no se cambia: crea otra y traslada el stock');
    }
    if (input.isActive === false && before.isDefault) {
      throw AppError.rule(
        'No se puede desactivar la bodega por defecto. Marca otra como predeterminada primero.',
      );
    }

    const updated: WarehouseRecord = {
      ...before,
      name: input.name?.trim() ?? before.name,
      branchId: input.branchId !== undefined ? input.branchId : before.branchId,
      address: input.address !== undefined ? input.address : before.address,
      city: input.city !== undefined ? input.city : before.city,
      isDefault: input.isDefault ?? before.isDefault,
      isActive: input.isActive ?? before.isActive,
    };

    if (updated.isDefault && !before.isDefault) await this.warehouses.clearDefault(tx, id);
    await this.warehouses.update(tx, updated);

    await this.audit.record(tx, ctx, {
      action: 'UPDATE',
      entityType: 'warehouse',
      entityId: id,
      entityLabel: `${updated.code} · ${updated.name}`,
      before: { nombre: before.name, activa: before.isActive, porDefecto: before.isDefault },
      after: { nombre: updated.name, activa: updated.isActive, porDefecto: updated.isDefault },
    });
    return updated;
  }

  /** Una bodega con movimientos no se borra: se desactiva. */
  async remove(ctx: RequestContext, tx: Tx, id: string): Promise<void> {
    assertCan(ctx, 'inventory:warehouse:delete');
    const warehouse = await this.get(ctx, tx, id);

    if (await this.warehouses.hasMovements(tx, id)) {
      throw AppError.rule(
        `${warehouse.name} tiene movimientos de inventario y no se puede borrar. ` +
          'Desactívala: dejará de ofrecerse y su kardex seguirá consultable.',
      );
    }
    if (warehouse.isDefault) {
      throw AppError.rule('No se borra la bodega por defecto. Marca otra como predeterminada antes.');
    }

    await this.warehouses.softDelete(tx, id);
    await this.audit.record(tx, ctx, {
      action: 'DELETE',
      entityType: 'warehouse',
      entityId: id,
      entityLabel: `${warehouse.code} · ${warehouse.name}`,
      before: { codigo: warehouse.code, nombre: warehouse.name },
    });
  }

  /** Bodega principal de una empresa nueva. Idempotente. */
  async seedDefault(tx: Tx, organizationId: string): Promise<boolean> {
    const { rowCount } = await tx.client.query(
      `INSERT INTO warehouses (id, organization_id, code, name, is_default)
       VALUES ($1,$2,'PRIN','Bodega principal',true)
       ON CONFLICT (organization_id, code) DO NOTHING`,
      [newId(), organizationId],
    );
    return (rowCount ?? 0) > 0;
  }
}

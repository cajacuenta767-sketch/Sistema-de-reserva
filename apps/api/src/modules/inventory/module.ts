import { crudPermissions, definePermission } from '@erp/contracts';
import { newId } from '@erp/core';
import { defineModule } from '../../platform/modules/types.js';
import { onTransactional } from '../../platform/events/EventBus.js';
import { systemContext } from '../../platform/authz/RequestContext.js';
import type { Tx } from '../../platform/db/unitOfWork.js';
import { WarehouseUseCases } from './application/use-cases/WarehouseUseCases.js';
import { StockUseCases } from './application/use-cases/StockUseCases.js';
import { CountUseCases } from './application/use-cases/CountUseCases.js';
import {
  PgCountRepository,
  PgLotRepository,
  PgMoveRepository,
  PgWarehouseRepository,
} from './infrastructure/persistence/PgInventoryRepositories.js';
import { PgProductReader } from './infrastructure/persistence/PgProductReader.js';
import { inventoryRoutes } from './infrastructure/http/inventory.routes.js';

export interface InventoryApi {
  warehouses: WarehouseUseCases;
  stock: StockUseCases;
  counts: CountUseCases;
  seedForOrganization(tx: Tx, organizationId: string): Promise<void>;
}

export const inventoryModule = defineModule<'inventory', InventoryApi>({
  id: 'inventory',
  basePath: '/inventory',
  // Lee productos por SQL directo, sin importar código de `catalog`.
  dependsOn: ['catalog'],

  permissions: [
    ...crudPermissions('inventory', 'warehouse', 'bodegas', ['ORG']),
    definePermission('inventory:stock:read', 'Ver existencias'),
    definePermission('inventory:move:read', 'Ver el kardex', {
      description: 'El movimiento de cada producto con su saldo y su costo en cada paso.',
    }),
    definePermission('inventory:move:create', 'Registrar movimientos de inventario'),
    definePermission('inventory:move:adjust', 'Ajustar existencias', {
      description:
        'Un ajuste cambia el inventario sin un documento que lo respalde. Se separa de ' +
        'registrar movimientos porque es la vía por la que desaparece mercancía sin rastro.',
    }),
    ...crudPermissions('inventory', 'count', 'conteos físicos', ['ORG']),
    definePermission('inventory:count:apply', 'Aplicar conteos físicos', {
      description:
        'Convierte lo contado en ajustes reales. Aparte de editar el conteo porque aplicar ' +
        'uno a medias sería una baja masiva de inventario.',
    }),
  ],

  register(ctx): InventoryApi {
    const warehouseRepo = new PgWarehouseRepository();
    const moveRepo = new PgMoveRepository();
    const lotRepo = new PgLotRepository();
    const countRepo = new PgCountRepository();
    const productReader = new PgProductReader();

    const warehouses = new WarehouseUseCases(warehouseRepo, ctx.audit);
    const stock = new StockUseCases(
      moveRepo,
      warehouseRepo,
      lotRepo,
      () => productReader,
      ctx.audit,
      ctx.clock,
    );
    const counts = new CountUseCases(
      countRepo,
      warehouseRepo,
      stock,
      ctx.sequences,
      ctx.audit,
      ctx.clock,
    );

    return {
      warehouses,
      stock,
      counts,

      async seedForOrganization(tx: Tx, organizationId: string): Promise<void> {
        await warehouses.seedDefault(tx, organizationId);
        await tx.client.query(
          `INSERT INTO document_sequences (id, organization_id, doc_type, prefix, padding)
           VALUES ($1,$2,'stock_count','CONT-',5)
           ON CONFLICT (organization_id, doc_type, prefix,
                        COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid))
           DO NOTHING`,
          [newId(), organizationId],
        );
      },
    };
  },

  routes: (ctx, api) =>
    inventoryRoutes(ctx, { warehouses: api.warehouses, stock: api.stock, counts: api.counts }),

  subscriptions(_ctx, api) {
    return [
      onTransactional('organization.created', 'inventory:seed', async (event, tx) => {
        await api.seedForOrganization(tx, event.organizationId);
      }),

      /**
       * Emitir una factura descuenta el inventario.
       *
       * Transaccional, igual que la contabilización: si el descuento falla, la
       * factura no se emite. Lo contrario dejaría facturas emitidas cuya
       * mercancía sigue figurando en bodega, y el inventario del sistema se
       * separaría del real sin nada que lo explique.
       *
       * `allowNegative`: NO se bloquea la factura porque el inventario diga
       * cero. La mercancía está en el mostrador y el cliente está pagando;
       * negarse a facturar es peor que registrar un saldo negativo, que además
       * es la señal de que hay una entrada sin registrar.
       */
      onTransactional('invoice.issued', 'inventory:issue-stock', async (event, tx) => {
        const payload = event.payload as Record<string, unknown>;
        const lines = Array.isArray(payload.stockLines)
          ? (payload.stockLines as Array<{ productId: string; quantity: string }>)
          : [];
        if (lines.length === 0) return;

        const context = systemContext(event.organizationId);
        for (const line of lines) {
          await api.stock.move(context, tx, {
            productId: line.productId,
            quantity: `-${line.quantity}`,
            kind: 'ISSUE',
            moveDate: String(payload.issueDate),
            sourceType: 'sales_invoice',
            sourceId: event.aggregateId,
            notes: `Factura ${String(payload.number)}`,
            allowNegative: true,
          });
        }
      }),

      /** Anular la factura devuelve la mercancía a la bodega. */
      onTransactional('invoice.voided', 'inventory:return-stock', async (event, tx) => {
        const context = systemContext(event.organizationId);
        const issued = await api.stock.movesForSource(
          context,
          tx,
          'sales_invoice',
          event.aggregateId,
        );

        for (const row of issued) {
          // Solo las salidas: si la factura ya se anuló una vez, sus entradas
          // de devolución también están aquí y devolverlas otra vez duplicaría
          // la mercancía.
          if (!row.quantity.startsWith('-')) continue;
          await api.stock.move(context, tx, {
            productId: row.productId,
            warehouseId: row.warehouseId,
            quantity: row.quantity.slice(1),
            unitCost: row.unitCost,
            kind: 'RETURN_IN',
            sourceType: 'sales_invoice',
            sourceId: event.aggregateId,
            notes: `Anulación de la factura ${String((event.payload as Record<string, unknown>).number ?? '')}`,
          });
        }
      }),
    ];
  },

  search(_ctx, api) {
    return [
      {
        entityType: 'stock',
        label: 'Existencias',
        permission: 'inventory:stock:read',
        async search(tx, requestContext, term, limit) {
          const result = await api.stock.levels(requestContext, tx, {
            page: 1,
            pageSize: limit,
            offset: 0,
            sort: [],
            filters: [],
            search: term,
            all: false,
          });
          return result.items.map((row) => ({
            entityType: 'stock',
            id: String(row.product_id),
            title: String(row.product_name),
            subtitle: `${String(row.available)} disponibles en ${String(row.warehouse_name)}`,
            url: `/inventario/existencias?q=${encodeURIComponent(String(row.product_name))}`,
          }));
        },
      },
    ];
  },
});


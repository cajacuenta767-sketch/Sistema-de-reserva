import { crudPermissions, definePermission } from '@erp/contracts';
import { newId } from '@erp/core';
import { defineModule } from '../../platform/modules/types.js';
import { onTransactional } from '../../platform/events/EventBus.js';
import type { Tx } from '../../platform/db/unitOfWork.js';
import { PurchaseOrderUseCases } from './application/use-cases/PurchaseUseCases.js';
import { ReceiptUseCases } from './application/use-cases/ReceiptUseCases.js';
import { BillUseCases } from './application/use-cases/BillUseCases.js';
import {
  PgBillRepository,
  PgPurchaseOrderRepository,
  PgReceiptRepository,
} from './infrastructure/persistence/PgPurchasingRepositories.js';
import {
  PgPurchaseCatalogReader,
  PgWithholdingReader,
} from './infrastructure/persistence/PgCatalogReaders.js';
import { purchasingRoutes } from './infrastructure/http/purchasing.routes.js';

export interface PurchasingApi {
  orders: PurchaseOrderUseCases;
  receipts: ReceiptUseCases;
  bills: BillUseCases;
  seedSequences(tx: Tx, organizationId: string): Promise<void>;
}

const DEFAULT_SEQUENCES = [
  { docType: 'purchase_order', prefix: 'OC-', padding: 5 },
  { docType: 'goods_receipt', prefix: 'ENT-', padding: 5 },
  { docType: 'purchase_bill', prefix: 'FC-', padding: 6 },
  { docType: 'payment_out', prefix: 'CE-', padding: 5 },
] as const;

export const purchasingModule = defineModule<'purchasing', PurchasingApi>({
  id: 'purchasing',
  basePath: '/purchasing',
  dependsOn: ['crm', 'catalog', 'inventory'],

  permissions: [
    ...crudPermissions('purchasing', 'order', 'órdenes de compra', ['OWN', 'TEAM', 'BRANCH', 'ORG']),
    definePermission('purchasing:order:send', 'Enviar órdenes al proveedor', {
      description: 'Asigna el consecutivo y compromete a la empresa con el pedido.',
    }),
    ...crudPermissions('purchasing', 'receipt', 'recepciones de mercancía', ['ORG']),
    definePermission('purchasing:receipt:post', 'Contabilizar recepciones', {
      description: 'Es lo que mueve el inventario: ni la orden ni la factura lo hacen.',
    }),
    definePermission('purchasing:receipt:void', 'Anular recepciones'),
    ...crudPermissions('purchasing', 'bill', 'facturas de proveedor', [
      'OWN',
      'TEAM',
      'BRANCH',
      'ORG',
    ]),
    definePermission('purchasing:bill:post', 'Contabilizar facturas de proveedor', {
      description: 'La vuelve una deuda exigible y genera su asiento.',
    }),
    definePermission('purchasing:bill:void', 'Anular facturas de proveedor'),
  ],

  register(ctx): PurchasingApi {
    const orderRepo = new PgPurchaseOrderRepository();
    const receiptRepo = new PgReceiptRepository();
    const billRepo = new PgBillRepository();
    const catalogReader = new PgPurchaseCatalogReader();
    const withholdingReader = new PgWithholdingReader();

    const orders = new PurchaseOrderUseCases(
      orderRepo,
      receiptRepo,
      () => catalogReader,
      ctx.sequences,
      ctx.audit,
      ctx.events,
      ctx.clock,
    );

    return {
      orders,
      receipts: new ReceiptUseCases(
        receiptRepo,
        orders,
        ctx.sequences,
        ctx.audit,
        ctx.events,
        ctx.clock,
      ),
      bills: new BillUseCases(
        billRepo,
        () => catalogReader,
        () => withholdingReader,
        ctx.sequences,
        ctx.audit,
        ctx.events,
        ctx.clock,
      ),

      async seedSequences(tx: Tx, organizationId: string): Promise<void> {
        for (const seq of DEFAULT_SEQUENCES) {
          await tx.client.query(
            `INSERT INTO document_sequences (id, organization_id, doc_type, prefix, padding)
             VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (organization_id, doc_type, prefix,
                          COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid))
             DO NOTHING`,
            [newId(), organizationId, seq.docType, seq.prefix, seq.padding],
          );
        }
      },
    };
  },

  routes: (ctx, api) =>
    purchasingRoutes(ctx, { orders: api.orders, receipts: api.receipts, bills: api.bills }),

  subscriptions(_ctx, api) {
    return [
      onTransactional('organization.created', 'purchasing:seed-sequences', async (event, tx) => {
        await api.seedSequences(tx, event.organizationId);
      }),
    ];
  },

  search(_ctx, api) {
    return [
      {
        entityType: 'bill',
        label: 'Facturas de proveedor',
        permission: 'purchasing:bill:read',
        async search(tx, requestContext, term, limit) {
          const result = await api.bills.list(requestContext, tx, {
            page: 1,
            pageSize: limit,
            offset: 0,
            sort: [],
            filters: [],
            search: term,
            all: false,
          });
          return result.items.map((row) => ({
            entityType: 'bill',
            id: String(row.id),
            title: String(row.supplier_number),
            subtitle: `${String(row.party_name)} · ${String(row.total)}`,
            url: `/compras/facturas/${String(row.id)}`,
          }));
        },
      },
    ];
  },
});

import { crudPermissions, definePermission } from '@erp/contracts';
import { newId } from '@erp/core';
import { defineModule } from '../../platform/modules/types.js';
import { onTransactional } from '../../platform/events/EventBus.js';
import type { Tx } from '../../platform/db/unitOfWork.js';
import { InvoiceUseCases } from './application/use-cases/InvoiceUseCases.js';
import { QuoteUseCases } from './application/use-cases/QuoteUseCases.js';
import { PaymentUseCases } from './application/use-cases/PaymentUseCases.js';
import {
  DocumentBuilder,
  type CatalogReader,
  type TaxReader,
} from './application/use-cases/DocumentBuilder.js';
import {
  PgInvoiceRepository,
  PgLineRepository,
  PgWithholdingRepository,
} from './infrastructure/persistence/PgInvoiceRepository.js';
import { PgPaymentRepository, PgQuoteRepository } from './infrastructure/persistence/PgSalesRepositories.js';
import { salesRoutes } from './infrastructure/http/sales.routes.js';

export interface SalesApi {
  invoices: InvoiceUseCases;
  quotes: QuoteUseCases;
  payments: PaymentUseCases;
  /** Numeraciones con las que arranca una empresa. Idempotente. */
  seedSequences(tx: Tx, organizationId: string): Promise<number>;
}

/**
 * Numeraciones por defecto.
 *
 * La de facturas arranca sin rango: el rango lo fija la resolución de la DIAN,
 * que cada empresa solicita y tiene sus propios números. Ponerle uno inventado
 * haría que la primera factura naciera fuera del rango autorizado.
 */
const DEFAULT_SEQUENCES = [
  { docType: 'sales_quote', prefix: 'COT-', padding: 5 },
  { docType: 'sales_invoice', prefix: 'FV-', padding: 6 },
  { docType: 'credit_note', prefix: 'NC-', padding: 5 },
  { docType: 'payment_in', prefix: 'RC-', padding: 5 },
] as const;

export const salesModule = defineModule<'sales', SalesApi>({
  id: 'sales',
  // Ventas lee del catálogo y del CRM. El orden solo afecta al registro; en
  // caliente se resuelve por la API pública de cada módulo.
  dependsOn: ['crm', 'catalog'],

  permissions: [
    ...crudPermissions('sales', 'quote', 'cotizaciones', ['OWN', 'TEAM', 'BRANCH', 'ORG']),
    ...crudPermissions('sales', 'invoice', 'facturas de venta', ['OWN', 'TEAM', 'BRANCH', 'ORG']),
    definePermission('sales:invoice:issue', 'Emitir facturas', {
      description:
        'Asigna el consecutivo y vuelve la factura inmutable. Es el acto que la hace existir ' +
        'para la DIAN, así que se separa de crearla.',
    }),
    definePermission('sales:invoice:void', 'Anular facturas', {
      description: 'Solo facturas sin pagos; las cobradas se corrigen con nota de crédito.',
    }),
    ...crudPermissions('sales', 'payment', 'pagos recibidos', ['OWN', 'TEAM', 'BRANCH', 'ORG']),
    definePermission('sales:payment:void', 'Anular pagos recibidos'),
  ],

  register(ctx): SalesApi {
    const invoiceRepo = new PgInvoiceRepository();
    const lineRepo = new PgLineRepository();
    const withholdingRepo = new PgWithholdingRepository();
    const quoteRepo = new PgQuoteRepository();
    const paymentRepo = new PgPaymentRepository();

    // Perezoso: en `register()` el otro módulo puede no estar construido aún.
    const builder = new DocumentBuilder(
      () => ctx.module<{ products: CatalogReader }>('catalog').products,
      () => ctx.module<{ taxes: TaxReader }>('catalog').taxes,
      ctx.clock,
    );

    const invoices = new InvoiceUseCases(
      invoiceRepo,
      lineRepo,
      withholdingRepo,
      paymentRepo,
      builder,
      ctx.sequences,
      ctx.audit,
      ctx.events,
      ctx.clock,
    );

    return {
      invoices,
      quotes: new QuoteUseCases(
        quoteRepo,
        lineRepo,
        invoices,
        builder,
        ctx.sequences,
        ctx.audit,
        ctx.events,
        ctx.clock,
      ),
      payments: new PaymentUseCases(
        paymentRepo,
        invoiceRepo,
        ctx.sequences,
        ctx.audit,
        ctx.events,
        ctx.clock,
      ),

      async seedSequences(tx: Tx, organizationId: string): Promise<number> {
        let created = 0;
        for (const seq of DEFAULT_SEQUENCES) {
          const { rowCount } = await tx.client.query(
            `INSERT INTO document_sequences (id, organization_id, doc_type, prefix, padding)
             VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (organization_id, doc_type, prefix,
                          COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid))
             DO NOTHING`,
            [newId(), organizationId, seq.docType, seq.prefix, seq.padding],
          );
          created += rowCount ?? 0;
        }
        return created;
      },
    };
  },

  routes: salesRoutes,

  /**
   * Las numeraciones se crean con la empresa, en la misma transacción.
   *
   * Sin ellas, el primer intento de emitir una factura falla con "no hay una
   * numeración configurada", justo cuando alguien está intentando cobrar.
   */
  subscriptions(_ctx, api) {
    return [
      onTransactional('organization.created', 'sales:seed-sequences', async (event, tx) => {
        await api.seedSequences(tx, event.organizationId);
      }),
    ];
  },

  search(_ctx, api) {
    return [
      {
        entityType: 'invoice',
        label: 'Facturas',
        permission: 'sales:invoice:read',
        async search(tx, requestContext, term, limit) {
          const result = await api.invoices.list(requestContext, tx, {
            page: 1,
            pageSize: limit,
            offset: 0,
            sort: [],
            filters: [],
            search: term,
            all: false,
          });
          return result.items.map((i) => ({
            entityType: 'invoice',
            id: i.id,
            title: i.number ?? 'Borrador',
            subtitle: `${i.party_name} · ${i.total}`,
            url: `/facturas/${i.id}`,
          }));
        },
      },
    ];
  },
});

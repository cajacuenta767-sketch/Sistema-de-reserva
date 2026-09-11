import { crudPermissions, definePermission } from '@erp/contracts';
import { Money, newId } from '@erp/core';
import { defineModule } from '../../platform/modules/types.js';
import { onTransactional } from '../../platform/events/EventBus.js';
import { systemContext } from '../../platform/authz/RequestContext.js';
import type { Tx } from '../../platform/db/unitOfWork.js';
import { ChartUseCases } from './application/use-cases/ChartUseCases.js';
import { PeriodUseCases } from './application/use-cases/PeriodUseCases.js';
import { EntryUseCases } from './application/use-cases/EntryUseCases.js';
import { ReportUseCases } from './application/use-cases/ReportUseCases.js';
import { PostingService } from './application/use-cases/PostingService.js';
import {
  PgAccountRepository,
  PgMappingRepository,
} from './infrastructure/persistence/PgAccountRepository.js';
import {
  PgFiscalYearRepository,
  PgJournalRepository,
  PgPeriodRepository,
} from './infrastructure/persistence/PgPeriodRepository.js';
import {
  PgEntryRepository,
  PgReportRepository,
} from './infrastructure/persistence/PgEntryRepository.js';
import { accountingRoutes } from './infrastructure/http/accounting.routes.js';
import { postCreditNote, postPaymentIn, postSalesInvoice } from './domain/PostingEngine.js';
import type { JournalType } from './domain/JournalEntry.js';

export interface AccountingApi {
  chart: ChartUseCases;
  periods: PeriodUseCases;
  entries: EntryUseCases;
  reports: ReportUseCases;
  posting: PostingService;
  /** Siembra PUC, diarios y cuentas por operación. Idempotente. */
  seedForOrganization(tx: Tx, organizationId: string): Promise<void>;
}

/**
 * Diarios por defecto.
 *
 * Cada uno con su propio prefijo de consecutivo, que es lo que permite mirar
 * "todos los asientos de ventas de marzo" sin leer los cuatro mil del mes.
 */
const DEFAULT_JOURNALS: ReadonlyArray<{
  code: string;
  name: string;
  type: JournalType;
  prefix: string;
}> = [
  { code: 'VT', name: 'Ventas', type: 'SALES', prefix: 'VT-' },
  { code: 'CP', name: 'Compras', type: 'PURCHASES', prefix: 'CP-' },
  { code: 'CJ', name: 'Caja y bancos', type: 'CASH', prefix: 'CJ-' },
  { code: 'NM', name: 'Nómina', type: 'PAYROLL', prefix: 'NM-' },
  { code: 'IN', name: 'Inventario', type: 'INVENTORY', prefix: 'IN-' },
  { code: 'GN', name: 'General', type: 'GENERAL', prefix: 'GN-' },
  { code: 'AP', name: 'Apertura', type: 'OPENING', prefix: 'AP-' },
  { code: 'CI', name: 'Cierre', type: 'CLOSING', prefix: 'CI-' },
];

const cop = (value: unknown): Money => Money.fromDb(String(value ?? '0'), 'COP');

export const accountingModule = defineModule<'accounting', AccountingApi>({
  id: 'accounting',
  // Todo bajo /accounting. Son pantallas de un área concreta, y agruparlas evita
  // que `/accounts` choque el día que identity exponga cuentas de usuario.
  basePath: '/accounting',
  // Lee terceros del CRM para el auxiliar. Ventas NO es dependencia: la
  // contabilidad escucha eventos y no sabe que existe un módulo de ventas.
  dependsOn: ['crm'],

  permissions: [
    ...crudPermissions('accounting', 'account', 'cuentas contables', ['ORG']),
    ...crudPermissions('accounting', 'entry', 'asientos contables', ['ORG']),
    definePermission('accounting:entry:reverse', 'Reversar asientos', {
      description:
        'Un asiento contabilizado no se edita: se corrige con una reversión. ' +
        'Es un acto que deja rastro y por eso tiene permiso propio.',
    }),
    definePermission('accounting:journal:read', 'Ver diarios contables'),
    definePermission('accounting:period:read', 'Ver años y periodos contables'),
    definePermission('accounting:period:manage', 'Abrir años fiscales'),
    definePermission('accounting:period:close', 'Cerrar periodos contables', {
      description:
        'Cerrar enero significa que enero ya no se mueve. Es lo que hace que un ' +
        'balance presentado a la DIAN siga diciendo mañana lo que decía hoy.',
    }),
    definePermission('accounting:period:reopen', 'Reabrir periodos cerrados', {
      description:
        'Aparte de cerrar a propósito: cerrar es rutina de fin de mes, reabrir es ' +
        'deshacer algo ya declarado.',
    }),
    definePermission('accounting:report:read', 'Ver informes contables', {
      description: 'Balance de prueba, estado de resultados, balance general y libro mayor.',
    }),
  ],

  register(ctx): AccountingApi {
    const accountRepo = new PgAccountRepository();
    const mappingRepo = new PgMappingRepository();
    const journalRepo = new PgJournalRepository();
    const yearRepo = new PgFiscalYearRepository();
    const periodRepo = new PgPeriodRepository();
    const entryRepo = new PgEntryRepository();
    const reportRepo = new PgReportRepository();

    const posting = new PostingService(
      accountRepo,
      mappingRepo,
      journalRepo,
      periodRepo,
      entryRepo,
      ctx.sequences,
      ctx.clock,
      ctx.logger,
    );

    const chart = new ChartUseCases(accountRepo, mappingRepo, ctx.audit, ctx.clock);
    const periods = new PeriodUseCases(yearRepo, periodRepo, ctx.audit, ctx.clock);

    return {
      chart,
      periods,
      posting,
      entries: new EntryUseCases(entryRepo, accountRepo, posting, ctx.audit, ctx.clock),
      reports: new ReportUseCases(reportRepo, accountRepo, ctx.clock),

      async seedForOrganization(tx: Tx, organizationId: string): Promise<void> {
        await chart.seedChart(tx, organizationId);

        for (const journal of DEFAULT_JOURNALS) {
          await tx.client.query(
            `INSERT INTO journals (id, organization_id, code, name, type, sequence_prefix)
             VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (organization_id, code) DO NOTHING`,
            [newId(), organizationId, journal.code, journal.name, journal.type, journal.prefix],
          );
          // Un consecutivo por diario, reiniciado cada año: es como se numeran
          // los asientos en Colombia y como los espera cualquier contador.
          await tx.client.query(
            `INSERT INTO document_sequences
               (id, organization_id, doc_type, prefix, padding, period_scope)
             VALUES ($1,$2,'journal_entry',$3,6,'YEAR')
             ON CONFLICT (organization_id, doc_type, prefix,
                          COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid))
             DO NOTHING`,
            [newId(), organizationId, journal.prefix],
          );
        }
      },
    };
  },

  routes: (ctx, api) =>
    accountingRoutes(ctx, {
      chart: api.chart,
      periods: api.periods,
      entries: api.entries,
      reports: api.reports,
      journalRepo: new PgJournalRepository(),
    }),

  /**
   * La contabilización automática.
   *
   * TRANSACCIONAL a propósito: el asiento se escribe en la MISMA transacción que
   * emite la factura. Si el asiento falla —periodo cerrado, cuenta sin
   * configurar—, la factura no se emite. Es lo que garantiza el invariante "no
   * existe una factura emitida sin su asiento", y lo que hace que el balance de
   * prueba cuadre siempre en vez de casi siempre.
   *
   * Hacerlo diferido sería más cómodo y dejaría facturas emitidas cuyo asiento
   * falló en segundo plano: descuadres que aparecen días después, sin nada que
   * los relacione con el documento que los causó.
   *
   * `accounting` no conoce `sales`: lee el evento, que es un contrato de datos.
   */
  subscriptions(ctx, api) {
    return [
      onTransactional('organization.created', 'accounting:seed', async (event, tx) => {
        await api.seedForOrganization(tx, event.organizationId);
      }),

      onTransactional('invoice.issued', 'accounting:post-invoice', async (event, tx) => {
        const p = event.payload as Record<string, unknown>;
        const context = systemContext(event.organizationId);
        const date = String(p.issueDate);
        await api.periods.ensureYearFor(context, tx, date);

        const subtotal = cop(p.subtotal);
        const draft = postSalesInvoice({
          number: String(p.number),
          date,
          partyId: String(p.partyId),
          partyName: String(p.partyName ?? 'Cliente'),
          currency: String(p.currency ?? 'COP'),
          exchangeRate: String(p.exchangeRate ?? '1'),
          subtotal,
          // Sin desglose por naturaleza, todo el ingreso va a mercancías: es lo
          // que hace el 90 % de las empresas y lo que el contador reclasifica
          // una vez. Inventar una separación sería peor que no tenerla.
          goodsRevenue: cop(p.goodsRevenue ?? p.subtotal),
          servicesRevenue: cop(p.servicesRevenue ?? '0'),
          vat: cop(p.vatTotal ?? p.taxTotal),
          consumptionTax: cop(p.consumptionTax ?? '0'),
          withholdingIncome: cop(p.withholdingIncome ?? '0'),
          withholdingVat: cop(p.withholdingVat ?? '0'),
          withholdingIca: cop(p.withholdingIca ?? '0'),
          total: cop(p.total),
        });

        await api.posting.post(tx, context, draft, {
          baseCurrency: 'COP',
          sourceId: event.aggregateId,
          actorMembershipId: event.actorMembershipId ?? null,
        });
      }),

      onTransactional('invoice.voided', 'accounting:reverse-invoice', async (event, tx) => {
        const context = systemContext(event.organizationId);
        const entry = await api.entries.forSource(context, tx, 'sales_invoice', event.aggregateId);
        // Una factura anulada sin asiento es una factura que nunca llegó a
        // contabilizarse: no hay nada que reversar y no es un error.
        if (!entry || entry.entry.reversedById) return;

        const reason = String((event.payload as Record<string, unknown>).reason ?? 'Factura anulada');
        await api.posting.reverse(
          tx,
          context,
          entry.entry,
          api.periods.today(),
          `Anulación de la factura · ${reason}`,
        );
      }),

      onTransactional('payment.received', 'accounting:post-payment', async (event, tx) => {
        const p = event.payload as Record<string, unknown>;
        const context = systemContext(event.organizationId);
        const date = String(p.paymentDate);
        await api.periods.ensureYearFor(context, tx, date);

        const draft = postPaymentIn({
          number: String(p.number),
          date,
          partyId: String(p.partyId),
          partyName: String(p.partyName ?? 'Cliente'),
          currency: String(p.currency ?? 'COP'),
          exchangeRate: String(p.exchangeRate ?? '1'),
          amount: cop(p.amount),
          applied: cop(p.applied),
          unapplied: cop(p.unapplied),
          method: (p.method as 'CASH' | 'TRANSFER' | 'CARD' | 'CHECK' | 'OTHER') ?? 'TRANSFER',
          invoiceNumbers: Array.isArray(p.invoiceNumbers) ? (p.invoiceNumbers as string[]) : [],
        });

        await api.posting.post(tx, context, draft, {
          baseCurrency: 'COP',
          sourceId: event.aggregateId,
          actorMembershipId: event.actorMembershipId ?? null,
        });
      }),

      onTransactional('payment.voided', 'accounting:reverse-payment', async (event, tx) => {
        const context = systemContext(event.organizationId);
        const entry = await api.entries.forSource(context, tx, 'payment', event.aggregateId);
        if (!entry || entry.entry.reversedById) return;

        const reason = String((event.payload as Record<string, unknown>).reason ?? 'Cobro anulado');
        await api.posting.reverse(
          tx,
          context,
          entry.entry,
          api.periods.today(),
          `Anulación del cobro · ${reason}`,
        );
      }),

      onTransactional('credit_note.issued', 'accounting:post-credit-note', async (event, tx) => {
        const p = event.payload as Record<string, unknown>;
        const context = systemContext(event.organizationId);
        const date = String(p.issueDate);
        await api.periods.ensureYearFor(context, tx, date);

        const draft = postCreditNote({
          number: String(p.number),
          invoiceNumber: String(p.invoiceNumber ?? ''),
          date,
          partyId: String(p.partyId),
          partyName: String(p.partyName ?? 'Cliente'),
          currency: String(p.currency ?? 'COP'),
          exchangeRate: String(p.exchangeRate ?? '1'),
          subtotal: cop(p.subtotal),
          vat: cop(p.taxTotal),
          total: cop(p.total),
        });

        await api.posting.post(tx, context, draft, {
          baseCurrency: 'COP',
          sourceId: event.aggregateId,
          actorMembershipId: event.actorMembershipId ?? null,
        });
      }),
    ];
  },

  search(_ctx, api) {
    return [
      {
        entityType: 'journal_entry',
        label: 'Asientos contables',
        permission: 'accounting:entry:read',
        async search(tx, requestContext, term, limit) {
          const result = await api.entries.list(requestContext, tx, {
            page: 1,
            pageSize: limit,
            offset: 0,
            sort: [],
            filters: [],
            search: term,
            all: false,
          });
          return result.items.map((row) => ({
            entityType: 'journal_entry',
            id: String(row.id),
            title: String(row.number ?? 'Borrador'),
            subtitle: `${String(row.memo)} · ${String(row.debit_total)}`,
            url: `/contabilidad/asientos/${String(row.id)}`,
          }));
        },
      },
    ];
  },
});


import { AppError, Money, newId, type Clock } from '@erp/core';
import type { ListQuery } from '@erp/contracts';
import type { Tx } from '../../../../platform/db/unitOfWork.js';
import type { RequestContext } from '../../../../platform/authz/RequestContext.js';
import type { AuditRecorder } from '../../../../platform/audit/AuditRecorder.js';
import type { EventBus } from '../../../../platform/events/EventBus.js';
import type { SequenceAllocator } from '../../../../platform/numbering/SequenceAllocator.js';
import { assertCan, assertWithinScope, scopeFilter } from '../../../../platform/authz/scope.js';
import type { ListResult } from '../../../../platform/http/list.js';
import {
  assertCanVoid,
  assertEditable,
  deriveInvoiceStatus,
  dueDateFrom,
  type InvoiceStatus,
} from '../../domain/Invoice.js';
import type {
  AgingRow,
  Invoice,
  InvoiceRepository,
  InvoiceRow,
  LineRepository,
  PaymentRepository,
  SalesOverview,
  StoredLine,
  StoredWithholding,
  WithholdingRepository,
} from '../ports/SalesRepositories.js';
import type { DocumentBuilder} from './DocumentBuilder.js';
import { type LineRequest } from './DocumentBuilder.js';

/** Escala de los importes en la base y, por tanto, en la API. */
const DB_DECIMALS = 4;

export interface CreateInvoiceInput {
  partyId: string;
  issueDate?: string;
  paymentTermsDays?: number;
  currencyCode?: string;
  priceListId?: string | null;
  globalDiscountPercent?: string;
  lines: readonly LineRequest[];
  withholdingCodes?: readonly string[];
  notes?: string | null;
  terms?: string | null;
  quoteId?: string | null;
  ownerMembershipId?: string | null;
}

export interface InvoiceDetail {
  invoice: Invoice;
  /** Estado de cartera: se deriva del saldo, no se guarda. */
  effectiveStatus: InvoiceStatus;
  outstanding: string;
  lines: StoredLine[];
  withholdings: StoredWithholding[];
  payments: Array<{ paymentId: string; number: string | null; paymentDate: string; amount: string }>;
}

export class InvoiceUseCases {
  constructor(
    private readonly invoices: InvoiceRepository,
    private readonly lines: LineRepository,
    private readonly withholdings: WithholdingRepository,
    private readonly payments: PaymentRepository,
    private readonly builder: DocumentBuilder,
    private readonly sequences: SequenceAllocator,
    private readonly audit: AuditRecorder,
    private readonly events: EventBus,
    private readonly clock: Clock,
  ) {}

  async list(ctx: RequestContext, tx: Tx, query: ListQuery): Promise<ListResult<InvoiceRow>> {
    assertCan(ctx, 'sales:invoice:read');
    return this.invoices.list(tx, query, scopeFilter(ctx, 'sales:invoice:read'), this.builder.today());
  }

  async get(ctx: RequestContext, tx: Tx, id: string): Promise<InvoiceDetail> {
    assertCan(ctx, 'sales:invoice:read');
    const invoice = await this.requireInvoice(ctx, tx, id, 'sales:invoice:read');

    const lines = await this.lines.listFor(tx, { invoiceId: id });
    const withholdings = await this.withholdings.listFor(tx, id);
    const payments = await this.payments.allocationsForInvoice(tx, id);

    return {
      invoice,
      effectiveStatus: this.statusOf(invoice),
      // Cuatro decimales, como los importes que vienen de la base: una respuesta
      // que mezcla escalas obliga al cliente a escribir dos analizadores.
      outstanding: Money.fromDb(invoice.total, invoice.currencyCode)
        .minus(Money.fromDb(invoice.paidTotal, invoice.currencyCode))
        .toDb(DB_DECIMALS),
      lines,
      withholdings,
      payments,
    };
  }

  async overview(ctx: RequestContext, tx: Tx): Promise<SalesOverview> {
    assertCan(ctx, 'sales:invoice:read');
    return this.invoices.overview(tx, ctx.organizationId, this.builder.today(), scopeFilter(ctx, 'sales:invoice:read'));
  }

  async aging(ctx: RequestContext, tx: Tx): Promise<AgingRow[]> {
    assertCan(ctx, 'sales:invoice:read');
    return this.invoices.aging(tx, ctx.organizationId, this.builder.today(), scopeFilter(ctx, 'sales:invoice:read'));
  }

  /** Crea un BORRADOR. El consecutivo se asigna al emitir, no aquí. */
  async create(ctx: RequestContext, tx: Tx, input: CreateInvoiceInput): Promise<InvoiceDetail> {
    assertCan(ctx, 'sales:invoice:create');

    const currency = input.currencyCode ?? 'COP';
    const issueDate = input.issueDate ?? this.builder.today();
    const terms = input.paymentTermsDays ?? 0;

    const built = await this.builder.build(ctx, tx, {
      lines: input.lines,
      currency,
      ...(input.globalDiscountPercent ? { globalDiscountPercent: input.globalDiscountPercent } : {}),
      ...(input.withholdingCodes ? { withholdingCodes: input.withholdingCodes } : {}),
    });

    const now = this.clock.now();
    const invoice: Invoice = {
      id: newId(),
      organizationId: ctx.organizationId,
      number: null,
      partyId: input.partyId,
      quoteId: input.quoteId ?? null,
      status: 'DRAFT',
      issueDate,
      dueDate: dueDateFrom(issueDate, terms),
      paymentTermsDays: terms,
      currencyCode: currency,
      exchangeRate: '1',
      priceListId: input.priceListId ?? null,
      globalDiscountPercent: input.globalDiscountPercent ?? '0',
      subtotal: built.totals.subtotal.toDb(),
      discountTotal: built.totals.discountTotal.toDb(),
      taxTotal: built.totals.taxTotal.toDb(),
      total: built.totals.total.toDb(),
      withholdingTotal: built.totals.withholdingTotal.toDb(),
      netPayable: built.totals.netPayable.toDb(),
      paidTotal: '0',
      notes: input.notes?.trim() || null,
      terms: input.terms?.trim() || null,
      dianResolution: null,
      issuedAt: null,
      voidedAt: null,
      voidReason: null,
      ownerMembershipId: input.ownerMembershipId ?? ctx.membershipId,
      branchId: ctx.branchId,
      createdAt: now,
    };

    await this.invoices.save(tx, invoice);
    await this.lines.replaceAll(tx, ctx.organizationId, { invoiceId: invoice.id }, built.lines);
    await this.withholdings.replaceAll(tx, ctx.organizationId, invoice.id, built.withholdings);

    await this.audit.record(tx, ctx, {
      action: 'CREATE',
      entityType: 'invoice',
      entityId: invoice.id,
      entityLabel: `Borrador · ${built.totals.total.toDb()} ${currency}`,
      after: { ...invoice },
    });

    return this.get(ctx, tx, invoice.id);
  }

  /** Solo se editan borradores. Una factura emitida se corrige con nota de crédito. */
  async update(
    ctx: RequestContext,
    tx: Tx,
    id: string,
    input: Partial<CreateInvoiceInput>,
  ): Promise<InvoiceDetail> {
    assertCan(ctx, 'sales:invoice:update');
    const before = await this.requireInvoice(ctx, tx, id, 'sales:invoice:update');
    assertEditable(this.statusOf(before));

    const currency = input.currencyCode ?? before.currencyCode;
    const issueDate = input.issueDate ?? before.issueDate;
    const terms = input.paymentTermsDays ?? before.paymentTermsDays;
    const globalDiscount = input.globalDiscountPercent ?? before.globalDiscountPercent;

    // Sin líneas nuevas se conservan las que hay, recalculadas: cambiar el
    // descuento global o las retenciones tiene que rehacer los totales.
    const lineRequests: LineRequest[] = input.lines
      ? [...input.lines]
      : (await this.lines.listFor(tx, { invoiceId: id })).map((l) => ({
          productId: l.productId,
          variantId: l.variantId,
          description: l.description,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          discountPercent: l.discountPercent,
          taxId: l.taxes[0]?.taxId ?? null,
        }));

    const withholdingCodes =
      input.withholdingCodes ?? (await this.withholdings.listFor(tx, id)).map((w) => w.code);

    const built = await this.builder.build(ctx, tx, {
      lines: lineRequests,
      currency,
      globalDiscountPercent: globalDiscount,
      withholdingCodes,
    });

    const invoice: Invoice = {
      ...before,
      partyId: input.partyId ?? before.partyId,
      issueDate,
      dueDate: dueDateFrom(issueDate, terms),
      paymentTermsDays: terms,
      currencyCode: currency,
      priceListId: input.priceListId === undefined ? before.priceListId : input.priceListId,
      globalDiscountPercent: globalDiscount,
      subtotal: built.totals.subtotal.toDb(),
      discountTotal: built.totals.discountTotal.toDb(),
      taxTotal: built.totals.taxTotal.toDb(),
      total: built.totals.total.toDb(),
      withholdingTotal: built.totals.withholdingTotal.toDb(),
      netPayable: built.totals.netPayable.toDb(),
      notes: input.notes === undefined ? before.notes : input.notes?.trim() || null,
      terms: input.terms === undefined ? before.terms : input.terms?.trim() || null,
      ownerMembershipId:
        input.ownerMembershipId === undefined ? before.ownerMembershipId : input.ownerMembershipId,
    };

    await this.invoices.update(tx, invoice);
    await this.lines.replaceAll(tx, ctx.organizationId, { invoiceId: id }, built.lines);
    await this.withholdings.replaceAll(tx, ctx.organizationId, id, built.withholdings);

    await this.audit.record(tx, ctx, {
      action: 'UPDATE',
      entityType: 'invoice',
      entityId: id,
      entityLabel: `Borrador · ${invoice.total} ${currency}`,
      before: { ...before },
      after: { ...invoice },
    });

    return this.get(ctx, tx, id);
  }

  /**
   * Emite la factura: le asigna el consecutivo y la vuelve inmutable.
   *
   * Es el punto de no retorno. A partir de aquí la factura existe para la DIAN,
   * cuenta para la declaración del periodo y solo se puede corregir con una nota
   * de crédito.
   */
  async issue(ctx: RequestContext, tx: Tx, id: string): Promise<InvoiceDetail> {
    assertCan(ctx, 'sales:invoice:issue');
    const before = await this.requireInvoice(ctx, tx, id, 'sales:invoice:issue');

    if (before.status === 'ISSUED') throw AppError.rule(`La factura ${before.number} ya está emitida`);
    if (before.status === 'VOID') throw AppError.rule('Una factura anulada no se puede emitir');

    const lines = await this.lines.listFor(tx, { invoiceId: id });
    if (lines.length === 0) throw AppError.rule('No se puede emitir una factura sin líneas');

    // El consecutivo se toma DENTRO de la transacción, con bloqueo: dos usuarios
    // emitiendo a la vez recibirían el mismo número si no.
    const allocated = await this.sequences.next(
      tx,
      { organizationId: ctx.organizationId, docType: 'sales_invoice', branchId: before.branchId },
      new Date(`${before.issueDate}T00:00:00Z`),
    );

    const invoice: Invoice = {
      ...before,
      number: allocated.formatted,
      status: 'ISSUED',
      issuedAt: this.clock.now(),
    };
    await this.invoices.update(tx, invoice);

    await this.audit.record(tx, ctx, {
      action: 'UPDATE',
      entityType: 'invoice',
      entityId: id,
      entityLabel: `${invoice.number} · ${invoice.total} ${invoice.currencyCode}`,
      before: { estado: 'DRAFT' },
      after: { estado: 'ISSUED', numero: invoice.number },
    });

    /*
     * Contabilidad, facturación electrónica e inventario escuchan esto. Ninguno
     * de esos módulos es conocido aquí.
     *
     * El evento lleva el DESGLOSE, no solo los totales. Un suscriptor que
     * recibiera `taxTotal` tendría que volver a consultar las líneas para saber
     * cuánto es IVA y cuánto INC —que van a cuentas distintas— y cuánto se
     * retuvo de cada clase. Un evento que obliga a reconsultar el agregado del
     * que salió no es un contrato: es un aviso de que algo pasó.
     */
    const breakdown = await this.invoices.accountingBreakdown(tx, id);
    const withheld = await this.withholdings.listFor(tx, id);
    const byKind = (kind: string): string =>
      withheld
        .filter((w) => w.kind === kind)
        .reduce((acc, w) => acc.plus(Money.fromDb(w.amount, invoice.currencyCode)), Money.zero(invoice.currencyCode))
        .toDb(DB_DECIMALS);

    await this.events.publish(tx, {
      type: 'invoice.issued',
      aggregateType: 'invoice',
      aggregateId: id,
      organizationId: ctx.organizationId,
      payload: {
        number: invoice.number,
        partyId: invoice.partyId,
        partyName: breakdown.partyName,
        issueDate: invoice.issueDate,
        dueDate: invoice.dueDate,
        currency: invoice.currencyCode,
        exchangeRate: invoice.exchangeRate,
        subtotal: invoice.subtotal,
        goodsRevenue: breakdown.goodsRevenue,
        servicesRevenue: breakdown.servicesRevenue,
        vatTotal: breakdown.vat,
        consumptionTax: breakdown.consumptionTax,
        taxTotal: invoice.taxTotal,
        total: invoice.total,
        withholdingTotal: invoice.withholdingTotal,
        withholdingIncome: byKind('WITHHOLDING_INCOME'),
        withholdingVat: byKind('WITHHOLDING_VAT'),
        withholdingIca: byKind('WITHHOLDING_ICA'),
        branchId: invoice.branchId,
      },
      actorMembershipId: ctx.membershipId,
    });

    return this.get(ctx, tx, id);
  }

  async void(ctx: RequestContext, tx: Tx, id: string, reason: string): Promise<InvoiceDetail> {
    assertCan(ctx, 'sales:invoice:void');
    const before = await this.requireInvoice(ctx, tx, id, 'sales:invoice:void');

    const motivo = reason.trim();
    if (!motivo) throw AppError.validation('Anular una factura exige un motivo');

    assertCanVoid({
      status: this.statusOf(before),
      paid: Money.fromDb(before.paidTotal, before.currencyCode),
    });

    const invoice: Invoice = {
      ...before,
      status: 'VOID',
      voidedAt: this.clock.now(),
      voidReason: motivo,
    };
    await this.invoices.update(tx, invoice);

    await this.audit.record(tx, ctx, {
      action: 'UPDATE',
      entityType: 'invoice',
      entityId: id,
      entityLabel: invoice.number ?? 'Borrador',
      before: { estado: before.status },
      after: { estado: 'VOID', motivo },
    });
    await this.events.publish(tx, {
      type: 'invoice.voided',
      aggregateType: 'invoice',
      aggregateId: id,
      organizationId: ctx.organizationId,
      payload: { number: invoice.number, reason: motivo, total: invoice.total },
      actorMembershipId: ctx.membershipId,
    });

    return this.get(ctx, tx, id);
  }

  /** Solo se borran borradores: una factura emitida ocupa un consecutivo. */
  async remove(ctx: RequestContext, tx: Tx, id: string): Promise<void> {
    assertCan(ctx, 'sales:invoice:delete');
    const before = await this.requireInvoice(ctx, tx, id, 'sales:invoice:delete');

    if (before.status !== 'DRAFT') {
      throw AppError.rule(
        `La factura ${before.number} está emitida y ocupa un consecutivo: anúlala en vez de borrarla`,
      );
    }

    await this.invoices.delete(tx, id);
    await this.audit.record(tx, ctx, {
      action: 'DELETE',
      entityType: 'invoice',
      entityId: id,
      entityLabel: `Borrador · ${before.total} ${before.currencyCode}`,
      before: { ...before },
    });
  }

  // ── Apoyo ─────────────────────────────────────────────────────────────────

  statusOf(invoice: Invoice): InvoiceStatus {
    return deriveInvoiceStatus({
      issued: invoice.status === 'ISSUED',
      voided: invoice.status === 'VOID',
      total: Money.fromDb(invoice.total, invoice.currencyCode),
      paid: Money.fromDb(invoice.paidTotal, invoice.currencyCode),
      dueDate: invoice.dueDate,
      today: this.builder.today(),
    });
  }

  private async requireInvoice(
    ctx: RequestContext,
    tx: Tx,
    id: string,
    permission: string,
  ): Promise<Invoice> {
    const invoice = await this.invoices.findById(tx, id);
    if (!invoice) throw AppError.notFound('Factura');
    assertWithinScope(ctx, permission, { ownerMembershipId: invoice.ownerMembershipId });
    return invoice;
  }
}

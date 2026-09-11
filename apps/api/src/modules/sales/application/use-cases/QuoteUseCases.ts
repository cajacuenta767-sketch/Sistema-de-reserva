import { AppError, newId, type Clock } from '@erp/core';
import type { ListQuery } from '@erp/contracts';
import type { Tx } from '../../../../platform/db/unitOfWork.js';
import type { RequestContext } from '../../../../platform/authz/RequestContext.js';
import type { AuditRecorder } from '../../../../platform/audit/AuditRecorder.js';
import type { EventBus } from '../../../../platform/events/EventBus.js';
import type { SequenceAllocator } from '../../../../platform/numbering/SequenceAllocator.js';
import { assertCan, assertWithinScope, scopeFilter } from '../../../../platform/authz/scope.js';
import type { ListResult } from '../../../../platform/http/list.js';
import { assertQuoteTransition, type QuoteStatus } from '../../domain/Invoice.js';
import type {
  LineRepository,
  Quote,
  QuoteRepository,
  QuoteRow,
  StoredLine,
} from '../ports/SalesRepositories.js';
import type { DocumentBuilder} from './DocumentBuilder.js';
import { type LineRequest } from './DocumentBuilder.js';
import type { InvoiceDetail, InvoiceUseCases } from './InvoiceUseCases.js';

export interface CreateQuoteInput {
  partyId: string;
  contactId?: string | null;
  issueDate?: string;
  /** Días de validez. Sin ellos, una cotización de hace un año sigue pareciendo vigente. */
  validForDays?: number;
  currencyCode?: string;
  priceListId?: string | null;
  globalDiscountPercent?: string;
  lines: readonly LineRequest[];
  notes?: string | null;
  terms?: string | null;
  ownerMembershipId?: string | null;
}

export interface QuoteDetail {
  quote: Quote;
  lines: StoredLine[];
  /** Vencida por fecha aunque su estado almacenado diga otra cosa. */
  isExpired: boolean;
}

export class QuoteUseCases {
  constructor(
    private readonly quotes: QuoteRepository,
    private readonly lines: LineRepository,
    private readonly invoices: InvoiceUseCases,
    private readonly builder: DocumentBuilder,
    private readonly sequences: SequenceAllocator,
    private readonly audit: AuditRecorder,
    private readonly events: EventBus,
    private readonly clock: Clock,
  ) {}

  async list(ctx: RequestContext, tx: Tx, query: ListQuery): Promise<ListResult<QuoteRow>> {
    assertCan(ctx, 'sales:quote:read');
    return this.quotes.list(tx, query, scopeFilter(ctx, 'sales:quote:read'));
  }

  async get(ctx: RequestContext, tx: Tx, id: string): Promise<QuoteDetail> {
    assertCan(ctx, 'sales:quote:read');
    const quote = await this.requireQuote(ctx, tx, id, 'sales:quote:read');
    const lines = await this.lines.listFor(tx, { quoteId: id });
    return { quote, lines, isExpired: this.isExpired(quote) };
  }

  async create(ctx: RequestContext, tx: Tx, input: CreateQuoteInput): Promise<QuoteDetail> {
    assertCan(ctx, 'sales:quote:create');

    const currency = input.currencyCode ?? 'COP';
    const issueDate = input.issueDate ?? this.builder.today();

    const built = await this.builder.build(ctx, tx, {
      lines: input.lines,
      currency,
      ...(input.globalDiscountPercent ? { globalDiscountPercent: input.globalDiscountPercent } : {}),
    });

    // La cotización SÍ lleva número desde el principio: no es un documento
    // fiscal, así que un hueco en su numeración no hay que justificarlo ante
    // nadie, y el comercial necesita citarla por teléfono antes de enviarla.
    const allocated = await this.sequences.next(
      tx,
      { organizationId: ctx.organizationId, docType: 'sales_quote', branchId: ctx.branchId },
      new Date(`${issueDate}T00:00:00Z`),
    );

    const quote: Quote = {
      id: newId(),
      organizationId: ctx.organizationId,
      number: allocated.formatted,
      partyId: input.partyId,
      contactId: input.contactId ?? null,
      status: 'DRAFT',
      issueDate,
      validUntil: input.validForDays ? addDays(issueDate, input.validForDays) : null,
      currencyCode: currency,
      priceListId: input.priceListId ?? null,
      globalDiscountPercent: input.globalDiscountPercent ?? '0',
      subtotal: built.totals.subtotal.toDb(),
      discountTotal: built.totals.discountTotal.toDb(),
      taxTotal: built.totals.taxTotal.toDb(),
      total: built.totals.total.toDb(),
      notes: input.notes?.trim() || null,
      terms: input.terms?.trim() || null,
      convertedInvoiceId: null,
      ownerMembershipId: input.ownerMembershipId ?? ctx.membershipId,
      branchId: ctx.branchId,
      createdAt: this.clock.now(),
    };

    await this.quotes.save(tx, quote);
    await this.lines.replaceAll(tx, ctx.organizationId, { quoteId: quote.id }, built.lines);

    await this.audit.record(tx, ctx, {
      action: 'CREATE',
      entityType: 'quote',
      entityId: quote.id,
      entityLabel: `${quote.number} · ${quote.total} ${currency}`,
      after: { ...quote },
    });

    return this.get(ctx, tx, quote.id);
  }

  async update(ctx: RequestContext, tx: Tx, id: string, input: Partial<CreateQuoteInput>): Promise<QuoteDetail> {
    assertCan(ctx, 'sales:quote:update');
    const before = await this.requireQuote(ctx, tx, id, 'sales:quote:update');

    if (before.status === 'CONVERTED') {
      throw AppError.rule('Esta cotización ya se convirtió en factura: crea una nueva');
    }

    const currency = input.currencyCode ?? before.currencyCode;
    const issueDate = input.issueDate ?? before.issueDate;
    const globalDiscount = input.globalDiscountPercent ?? before.globalDiscountPercent;

    const lineRequests: LineRequest[] = input.lines
      ? [...input.lines]
      : (await this.lines.listFor(tx, { quoteId: id })).map((l) => ({
          productId: l.productId,
          variantId: l.variantId,
          description: l.description,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          discountPercent: l.discountPercent,
          taxId: l.taxes[0]?.taxId ?? null,
        }));

    const built = await this.builder.build(ctx, tx, {
      lines: lineRequests,
      currency,
      globalDiscountPercent: globalDiscount,
    });

    const quote: Quote = {
      ...before,
      partyId: input.partyId ?? before.partyId,
      contactId: input.contactId === undefined ? before.contactId : input.contactId,
      issueDate,
      validUntil: input.validForDays ? addDays(issueDate, input.validForDays) : before.validUntil,
      currencyCode: currency,
      priceListId: input.priceListId === undefined ? before.priceListId : input.priceListId,
      globalDiscountPercent: globalDiscount,
      subtotal: built.totals.subtotal.toDb(),
      discountTotal: built.totals.discountTotal.toDb(),
      taxTotal: built.totals.taxTotal.toDb(),
      total: built.totals.total.toDb(),
      notes: input.notes === undefined ? before.notes : input.notes?.trim() || null,
      terms: input.terms === undefined ? before.terms : input.terms?.trim() || null,
    };

    await this.quotes.update(tx, quote);
    await this.lines.replaceAll(tx, ctx.organizationId, { quoteId: id }, built.lines);

    await this.audit.record(tx, ctx, {
      action: 'UPDATE',
      entityType: 'quote',
      entityId: id,
      entityLabel: `${quote.number} · ${quote.total} ${currency}`,
      before: { ...before },
      after: { ...quote },
    });

    return this.get(ctx, tx, id);
  }

  /** Cambia el estado respetando la máquina de estados. */
  async setStatus(ctx: RequestContext, tx: Tx, id: string, to: QuoteStatus): Promise<QuoteDetail> {
    assertCan(ctx, 'sales:quote:update');
    const before = await this.requireQuote(ctx, tx, id, 'sales:quote:update');
    assertQuoteTransition(before.status, to);

    const quote: Quote = { ...before, status: to };
    await this.quotes.update(tx, quote);

    await this.audit.record(tx, ctx, {
      action: 'UPDATE',
      entityType: 'quote',
      entityId: id,
      entityLabel: quote.number,
      before: { estado: before.status },
      after: { estado: to },
    });

    if (to === 'ACCEPTED') {
      await this.events.publish(tx, {
        type: 'quote.accepted',
        aggregateType: 'quote',
        aggregateId: id,
        organizationId: ctx.organizationId,
        payload: { number: quote.number, partyId: quote.partyId, total: quote.total },
        actorMembershipId: ctx.membershipId,
      });
    }

    return this.get(ctx, tx, id);
  }

  /**
   * Convierte la cotización en un borrador de factura.
   *
   * Copia las líneas TAL COMO ESTÁN: con el precio negociado, no con el vigente
   * hoy. Recalcularlo contra el catálogo cambiaría el total de lo que el cliente
   * ya aceptó, que es la peor sorpresa posible en una factura.
   */
  async convert(ctx: RequestContext, tx: Tx, id: string): Promise<InvoiceDetail> {
    assertCan(ctx, 'sales:invoice:create');
    const quote = await this.requireQuote(ctx, tx, id, 'sales:quote:read');

    assertQuoteTransition(quote.status, 'CONVERTED');

    const lines = await this.lines.listFor(tx, { quoteId: id });
    if (lines.length === 0) throw AppError.rule('No se puede convertir una cotización sin líneas');

    const invoice = await this.invoices.create(ctx, tx, {
      partyId: quote.partyId,
      currencyCode: quote.currencyCode,
      priceListId: quote.priceListId,
      globalDiscountPercent: quote.globalDiscountPercent,
      quoteId: quote.id,
      notes: quote.notes,
      terms: quote.terms,
      ownerMembershipId: quote.ownerMembershipId,
      lines: lines.map((l) => ({
        productId: l.productId,
        variantId: l.variantId,
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discountPercent: l.discountPercent,
        taxId: l.taxes[0]?.taxId ?? null,
      })),
    });

    await this.quotes.update(tx, { ...quote, status: 'CONVERTED', convertedInvoiceId: invoice.invoice.id });
    await this.audit.record(tx, ctx, {
      action: 'UPDATE',
      entityType: 'quote',
      entityId: id,
      entityLabel: quote.number,
      before: { estado: quote.status },
      after: { estado: 'CONVERTED', factura: invoice.invoice.id },
    });

    return invoice;
  }

  async remove(ctx: RequestContext, tx: Tx, id: string): Promise<void> {
    assertCan(ctx, 'sales:quote:delete');
    const before = await this.requireQuote(ctx, tx, id, 'sales:quote:delete');
    if (before.status === 'CONVERTED') {
      throw AppError.rule('Esta cotización dio origen a una factura: no se puede borrar');
    }

    await this.quotes.softDelete(tx, id, this.clock.now());
    await this.audit.record(tx, ctx, {
      action: 'DELETE',
      entityType: 'quote',
      entityId: id,
      entityLabel: before.number,
      before: { ...before },
    });
  }

  private isExpired(quote: Quote): boolean {
    if (quote.validUntil === null) return false;
    if (quote.status === 'CONVERTED' || quote.status === 'REJECTED') return false;
    return quote.validUntil < this.builder.today();
  }

  private async requireQuote(ctx: RequestContext, tx: Tx, id: string, permission: string): Promise<Quote> {
    const quote = await this.quotes.findById(tx, id);
    if (!quote) throw AppError.notFound('Cotización');
    assertWithinScope(ctx, permission, { ownerMembershipId: quote.ownerMembershipId });
    return quote;
  }
}

const addDays = (date: string, days: number): string => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

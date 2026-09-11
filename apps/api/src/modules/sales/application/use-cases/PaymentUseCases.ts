import { AppError, Money, newId, type Clock } from '@erp/core';
import type { ListQuery } from '@erp/contracts';
import type { Tx } from '../../../../platform/db/unitOfWork.js';
import type { RequestContext } from '../../../../platform/authz/RequestContext.js';
import type { AuditRecorder } from '../../../../platform/audit/AuditRecorder.js';
import type { EventBus } from '../../../../platform/events/EventBus.js';
import type { SequenceAllocator } from '../../../../platform/numbering/SequenceAllocator.js';
import { assertCan } from '../../../../platform/authz/scope.js';
import type { ListResult } from '../../../../platform/http/list.js';
import {
  allocateManually,
  allocateOldestFirst,
  type AllocationResult,
  type OpenInvoice,
} from '../../domain/PaymentAllocation.js';
import type {
  InvoiceRepository,
  Payment,
  PaymentRepository,
  PaymentRow,
} from '../ports/SalesRepositories.js';

/** Escala de los importes en la base y, por tanto, en la API. */
const DB_DECIMALS = 4;

export interface RegisterPaymentInput {
  partyId: string;
  amount: string;
  paymentDate?: string;
  method?: Payment['method'];
  currencyCode?: string;
  reference?: string | null;
  notes?: string | null;
  /** Imputación a mano. Sin ella se aplica de la factura más antigua a la más nueva. */
  allocations?: ReadonlyArray<{ invoiceId: string; amount: string }>;
}

export interface PaymentDetail {
  payment: Payment;
  allocations: Array<{ invoiceId: string; number: string | null; amount: string }>;
  /** Dinero recibido sin imputar: saldo a favor del cliente. */
  unapplied: string;
}

export class PaymentUseCases {
  constructor(
    private readonly payments: PaymentRepository,
    private readonly invoices: InvoiceRepository,
    private readonly sequences: SequenceAllocator,
    private readonly audit: AuditRecorder,
    private readonly events: EventBus,
    private readonly clock: Clock,
  ) {}

  async list(ctx: RequestContext, tx: Tx, query: ListQuery): Promise<ListResult<PaymentRow>> {
    assertCan(ctx, 'sales:payment:read');
    return this.payments.list(tx, query);
  }

  async get(ctx: RequestContext, tx: Tx, id: string): Promise<PaymentDetail> {
    assertCan(ctx, 'sales:payment:read');
    const payment = await this.requirePayment(tx, id);
    return this.detail(tx, payment);
  }

  /** Facturas abiertas de un cliente: lo que la pantalla de cobro necesita ver. */
  async openInvoices(ctx: RequestContext, tx: Tx, partyId: string) {
    assertCan(ctx, 'sales:payment:read');
    const invoices = await this.invoices.openForParty(tx, ctx.organizationId, partyId);
    return invoices.map((i) => ({
      id: i.id,
      number: i.number,
      issueDate: i.issueDate,
      dueDate: i.dueDate,
      total: i.total,
      paid: i.paidTotal,
      outstanding: Money.fromDb(i.total, i.currencyCode)
        .minus(Money.fromDb(i.paidTotal, i.currencyCode))
        .toDb(DB_DECIMALS),
      currencyCode: i.currencyCode,
    }));
  }

  /**
   * Registra un cobro y lo imputa.
   *
   * El saldo de cada factura afectada se RECALCULA desde las imputaciones, no se
   * incrementa: un contador que se acumula se descuadra en cuanto un pago se
   * anula o se reimputa, y ese error no se ve hasta que alguien cuadra la
   * cartera meses después.
   */
  async register(ctx: RequestContext, tx: Tx, input: RegisterPaymentInput): Promise<PaymentDetail> {
    assertCan(ctx, 'sales:payment:create');

    const currency = input.currencyCode ?? 'COP';
    const amount = Money.fromDb(input.amount, currency);
    const paymentDate = input.paymentDate ?? this.clock.now().toISOString().slice(0, 10);

    const open = await this.invoices.openForParty(tx, ctx.organizationId, input.partyId);
    const openForDomain: OpenInvoice[] = open.map((i) => ({
      id: i.id,
      number: i.number ?? '(sin número)',
      issueDate: i.issueDate,
      dueDate: i.dueDate,
      total: Money.fromDb(i.total, i.currencyCode),
      paid: Money.fromDb(i.paidTotal, i.currencyCode),
    }));

    const allocation: AllocationResult = input.allocations
      ? allocateManually(amount, input.allocations, openForDomain)
      : allocateOldestFirst(amount, openForDomain);

    const allocated = await this.sequences.next(
      tx,
      { organizationId: ctx.organizationId, docType: 'payment_in', branchId: ctx.branchId },
      new Date(`${paymentDate}T00:00:00Z`),
    );

    const payment: Payment = {
      id: newId(),
      organizationId: ctx.organizationId,
      number: allocated.formatted,
      partyId: input.partyId,
      direction: 'IN',
      paymentDate,
      method: input.method ?? 'TRANSFER',
      currencyCode: currency,
      amount: amount.toDb(),
      allocatedTotal: '0',
      reference: input.reference?.trim() || null,
      notes: input.notes?.trim() || null,
      voidedAt: null,
      voidReason: null,
      createdAt: this.clock.now(),
    };

    await this.payments.save(tx, payment);
    await this.payments.replaceAllocations(
      tx,
      ctx.organizationId,
      payment.id,
      allocation.lines.map((l) => ({ invoiceId: l.invoiceId, amount: l.amount.toDb() })),
    );
    for (const line of allocation.lines) await this.invoices.recalculatePaid(tx, line.invoiceId);

    await this.audit.record(tx, ctx, {
      action: 'CREATE',
      entityType: 'payment',
      entityId: payment.id,
      entityLabel: `${payment.number} · ${amount.toDb()} ${currency}`,
      after: {
        importe: amount.toDb(),
        imputado: allocation.applied.toDb(),
        sinImputar: allocation.unapplied.toDb(),
        facturas: allocation.lines.map((l) => l.number),
      },
    });

    await this.events.publish(tx, {
      type: 'payment.received',
      aggregateType: 'payment',
      aggregateId: payment.id,
      organizationId: ctx.organizationId,
      payload: {
        number: payment.number,
        partyId: payment.partyId,
        amount: amount.toDb(),
        currency,
        applied: allocation.applied.toDb(),
        unapplied: allocation.unapplied.toDb(),
        paymentDate,
      },
      actorMembershipId: ctx.membershipId,
    });

    const saved = await this.requirePayment(tx, payment.id);
    return this.detail(tx, saved);
  }

  /**
   * Anula un cobro.
   *
   * El pago NO se borra: se marca como anulado y sus imputaciones dejan de
   * contar. Borrarlo dejaría un movimiento de banco sin documento que lo
   * explique, y el extracto ya no cuadraría con la contabilidad.
   */
  async void(ctx: RequestContext, tx: Tx, id: string, reason: string): Promise<PaymentDetail> {
    assertCan(ctx, 'sales:payment:void');
    const before = await this.requirePayment(tx, id);

    const motivo = reason.trim();
    if (!motivo) throw AppError.validation('Anular un pago exige un motivo');
    if (before.voidedAt) throw AppError.rule(`El pago ${before.number} ya está anulado`);

    const affected = await this.payments.allocations(tx, id);
    await this.payments.update(tx, { ...before, voidedAt: this.clock.now(), voidReason: motivo });
    // Las facturas recuperan su saldo: `recalculatePaid` excluye los pagos anulados.
    for (const line of affected) await this.invoices.recalculatePaid(tx, line.invoiceId);

    await this.audit.record(tx, ctx, {
      action: 'UPDATE',
      entityType: 'payment',
      entityId: id,
      entityLabel: before.number ?? '',
      before: { estado: 'vigente' },
      after: { estado: 'anulado', motivo, facturasAfectadas: affected.map((a) => a.number) },
    });
    await this.events.publish(tx, {
      type: 'payment.voided',
      aggregateType: 'payment',
      aggregateId: id,
      organizationId: ctx.organizationId,
      payload: { number: before.number, amount: before.amount, reason: motivo },
      actorMembershipId: ctx.membershipId,
    });

    const saved = await this.requirePayment(tx, id);
    return this.detail(tx, saved);
  }

  private async detail(tx: Tx, payment: Payment): Promise<PaymentDetail> {
    const allocations = await this.payments.allocations(tx, payment.id);
    return {
      payment,
      allocations,
      unapplied: Money.fromDb(payment.amount, payment.currencyCode)
        .minus(Money.fromDb(payment.allocatedTotal, payment.currencyCode))
        .toDb(DB_DECIMALS),
    };
  }

  private async requirePayment(tx: Tx, id: string): Promise<Payment> {
    const payment = await this.payments.findById(tx, id);
    if (!payment) throw AppError.notFound('Pago');
    return payment;
  }
}

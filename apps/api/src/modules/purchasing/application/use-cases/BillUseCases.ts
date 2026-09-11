import {
  aggregateDocumentTotals,
  AppError,
  computeLineTotals,
  Decimal,
  Money,
  newId,
  type Clock,
  type LocalDate,
  type TaxDef,
} from '@erp/core';
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
  Bill,
  BillLine,
  BillRepository,
  PayableRow,
  StoredWithholding,
} from '../ports/PurchasingRepositories.js';
import type { PurchaseCatalogReader } from './PurchaseUseCases.js';

const DB_DECIMALS = 4;

export interface BillLineInput {
  productId?: string | null;
  accountId?: string | null;
  description?: string;
  quantity: string;
  unitPrice: string;
  discountPercent?: string;
}

export interface BillInput {
  supplierNumber: string;
  partyId: string;
  orderId?: string | null;
  receiptId?: string | null;
  issueDate?: LocalDate;
  paymentTermsDays?: number;
  currencyCode?: string;
  notes?: string | null;
  lines: readonly BillLineInput[];
  /** Retenciones que se le practican al proveedor. */
  withholdingTaxIds?: readonly string[];
}

export interface BillDetail {
  bill: Bill;
  partyName: string;
  lines: BillLine[];
  withholdings: StoredWithholding[];
  outstanding: string;
  effectiveStatus: string;
}

/** Definiciones de retención que el módulo necesita. No importa `catalog`. */
export interface WithholdingReader {
  byIds(tx: Tx, ids: readonly string[]): Promise<TaxDef[]>;
  defaultPurchaseWithholdings(tx: Tx): Promise<TaxDef[]>;
}

/**
 * Facturas de proveedor.
 *
 * La diferencia con una factura de venta: aquí las retenciones se PRACTICAN, no
 * se sufren. Reducen lo que se le transfiere al proveedor y se convierten en un
 * pasivo con la DIAN, porque ese dinero hay que consignarlo. Contabilizarlas
 * como menor gasto —el error simétrico al de ventas— subestimaría el costo y
 * dejaría sin registrar una obligación tributaria.
 */
export class BillUseCases {
  constructor(
    private readonly bills: BillRepository,
    private readonly catalog: () => PurchaseCatalogReader,
    private readonly withholdings: () => WithholdingReader,
    private readonly sequences: SequenceAllocator,
    private readonly audit: AuditRecorder,
    private readonly events: EventBus,
    private readonly clock: Clock,
  ) {}

  async list(ctx: RequestContext, tx: Tx, query: ListQuery): Promise<ListResult<Record<string, unknown>>> {
    assertCan(ctx, 'purchasing:bill:read');
    return this.bills.list(tx, query, this.today());
  }

  async get(ctx: RequestContext, tx: Tx, id: string): Promise<BillDetail> {
    assertCan(ctx, 'purchasing:bill:read');
    const bill = await this.bills.byId(tx, id);
    if (!bill) throw AppError.notFound('Factura de proveedor');
    return this.detail(tx, bill);
  }

  async create(ctx: RequestContext, tx: Tx, input: BillInput): Promise<BillDetail> {
    assertCan(ctx, 'purchasing:bill:create');
    const supplierNumber = input.supplierNumber.trim();
    if (!supplierNumber) {
      throw AppError.validation('La factura del proveedor necesita su número');
    }

    // Un proveedor no factura dos veces con el mismo número. Se comprueba aquí
    // para dar un mensaje útil; el índice único de la base es la garantía.
    const duplicate = await this.bills.bySupplierNumber(tx, input.partyId, supplierNumber);
    if (duplicate) {
      throw AppError.conflict(
        `Ya está registrada la factura ${supplierNumber} de este proveedor` +
          (duplicate.number ? ` (${duplicate.number})` : '') +
          '. Registrarla dos veces significa pagarla dos veces.',
      );
    }

    const id = newId();
    const built = await this.build(tx, input);
    const issueDate = input.issueDate ?? this.today();
    const terms = input.paymentTermsDays ?? 0;

    const bill: Bill = {
      id,
      organizationId: ctx.organizationId,
      number: null,
      supplierNumber,
      partyId: input.partyId,
      orderId: input.orderId ?? null,
      receiptId: input.receiptId ?? null,
      status: 'DRAFT',
      issueDate,
      dueDate: this.addDays(issueDate, terms),
      paymentTermsDays: terms,
      currencyCode: built.currency,
      exchangeRate: '1',
      subtotal: built.totals.subtotal.toDb(DB_DECIMALS),
      taxTotal: built.totals.taxTotal.toDb(DB_DECIMALS),
      total: built.totals.total.toDb(DB_DECIMALS),
      withholdingTotal: built.withholdingTotal.toDb(DB_DECIMALS),
      netPayable: built.totals.total.minus(built.withholdingTotal).toDb(DB_DECIMALS),
      paidTotal: '0',
      notes: input.notes ?? null,
      ownerMembershipId: ctx.membershipId,
      branchId: ctx.branchId,
    };

    await this.bills.save(tx, bill, actorMembershipId(ctx));
    await this.bills.replaceLines(tx, ctx.organizationId, id, built.lines);
    await this.bills.replaceWithholdings(tx, ctx.organizationId, id, built.withholdings);

    await this.audit.record(tx, ctx, {
      action: 'CREATE',
      entityType: 'bill',
      entityId: id,
      entityLabel: `${supplierNumber} · ${bill.total} ${bill.currencyCode}`,
      after: { proveedor: input.partyId, total: bill.total, retenciones: bill.withholdingTotal },
    });

    return this.get(ctx, tx, id);
  }

  /**
   * Contabiliza la factura: le da consecutivo interno y la vuelve una deuda.
   *
   * A partir de aquí cuenta en las cuentas por pagar y genera su asiento.
   */
  async post(ctx: RequestContext, tx: Tx, id: string): Promise<BillDetail> {
    assertCan(ctx, 'purchasing:bill:post');
    const bill = await this.requireBill(tx, id);
    if (bill.status === 'POSTED') throw AppError.rule(`La factura ${bill.number} ya está contabilizada`);
    if (bill.status === 'VOID') throw AppError.rule('Una factura anulada no se contabiliza');

    const lines = await this.bills.linesOf(tx, id);
    if (lines.length === 0) throw AppError.rule('No se puede contabilizar una factura sin líneas');

    const allocated = await this.sequences.next(
      tx,
      { organizationId: ctx.organizationId, docType: 'purchase_bill', branchId: bill.branchId },
      new Date(`${bill.issueDate}T00:00:00Z`),
    );
    await this.bills.post(tx, id, allocated.formatted);

    const withheld = await this.bills.withholdingsOf(tx, id);
    const sumOf = (kind: string): string =>
      withheld
        .filter((w) => w.kind === kind)
        .reduce((acc, w) => acc.plus(Money.fromDb(w.amount, bill.currencyCode)), Money.zero(bill.currencyCode))
        .toDb(DB_DECIMALS);

    await this.events.publish(tx, {
      type: 'bill.posted',
      aggregateType: 'bill',
      aggregateId: id,
      organizationId: ctx.organizationId,
      payload: {
        number: allocated.formatted,
        supplierNumber: bill.supplierNumber,
        partyId: bill.partyId,
        partyName: await this.partyName(tx, bill.partyId),
        issueDate: bill.issueDate,
        dueDate: bill.dueDate,
        currency: bill.currencyCode,
        exchangeRate: bill.exchangeRate,
        subtotal: bill.subtotal,
        vatTotal: this.vatOf(lines),
        total: bill.total,
        withholdingIncome: sumOf('WITHHOLDING_INCOME'),
        withholdingVat: sumOf('WITHHOLDING_VAT'),
        withholdingIca: sumOf('WITHHOLDING_ICA'),
        netPayable: bill.netPayable,
      },
      actorMembershipId: ctx.membershipId,
    });

    await this.audit.record(tx, ctx, {
      action: 'UPDATE',
      entityType: 'bill',
      entityId: id,
      entityLabel: allocated.formatted,
      before: { estado: 'DRAFT' },
      after: { estado: 'POSTED', numero: allocated.formatted },
    });

    return this.get(ctx, tx, id);
  }

  async void(ctx: RequestContext, tx: Tx, id: string, reason: string): Promise<BillDetail> {
    assertCan(ctx, 'purchasing:bill:void');
    const bill = await this.requireBill(tx, id);
    const motivo = reason.trim();
    if (!motivo) throw AppError.validation('Anular una factura exige un motivo');
    if (bill.status === 'VOID') throw AppError.rule('Esta factura ya está anulada');
    if (new Decimal(bill.paidTotal).greaterThan(0)) {
      throw AppError.rule(
        `La factura ${bill.supplierNumber} tiene pagos aplicados. ` +
          'Anula primero los pagos o registra una nota de crédito del proveedor.',
      );
    }

    await this.bills.void(tx, id, motivo);
    if (bill.status === 'POSTED') {
      await this.events.publish(tx, {
        type: 'bill.voided',
        aggregateType: 'bill',
        aggregateId: id,
        organizationId: ctx.organizationId,
        payload: { number: bill.number, reason: motivo },
        actorMembershipId: ctx.membershipId,
      });
    }

    await this.audit.record(tx, ctx, {
      action: 'UPDATE',
      entityType: 'bill',
      entityId: id,
      entityLabel: bill.number ?? bill.supplierNumber,
      before: { estado: bill.status },
      after: { estado: 'VOID', motivo },
    });
    return this.get(ctx, tx, id);
  }

  async payable(ctx: RequestContext, tx: Tx): Promise<PayableRow[]> {
    assertCan(ctx, 'purchasing:bill:read');
    return this.bills.payable(tx, this.today());
  }

  async openForParty(ctx: RequestContext, tx: Tx, partyId: string) {
    assertCan(ctx, 'purchasing:bill:read');
    const open = await this.bills.openForParty(tx, partyId);
    return open.map((b) => ({
      id: b.id,
      number: b.number,
      supplierNumber: b.supplierNumber,
      issueDate: b.issueDate,
      dueDate: b.dueDate,
      total: b.total,
      paid: b.paidTotal,
      outstanding: Money.fromDb(b.total, b.currencyCode)
        .minus(Money.fromDb(b.paidTotal, b.currencyCode))
        .toDb(DB_DECIMALS),
      currencyCode: b.currencyCode,
    }));
  }

  async recalculatePaid(tx: Tx, billId: string): Promise<void> {
    await this.bills.recalculatePaid(tx, billId);
  }

  private vatOf(lines: readonly BillLine[]): string {
    return lines
      .flatMap((l) => l.taxes)
      .filter((t) => t.kind === 'VAT')
      .reduce((acc, t) => acc.plus(t.amount), new Decimal(0))
      .toFixed(DB_DECIMALS);
  }

  private async partyName(tx: Tx, partyId: string): Promise<string> {
    const { rows } = await tx.client.query<{ display_name: string }>(
      'SELECT display_name FROM parties WHERE id = $1',
      [partyId],
    );
    return rows[0]?.display_name ?? 'Proveedor';
  }

  private async detail(tx: Tx, bill: Bill): Promise<BillDetail> {
    const outstanding = Money.fromDb(bill.total, bill.currencyCode)
      .minus(Money.fromDb(bill.paidTotal, bill.currencyCode))
      .toDb(DB_DECIMALS);

    // El estado se DERIVA del saldo, no se guarda: uno almacenado se
    // desincroniza en cuanto un pago se anula por otra vía.
    const effectiveStatus = (() => {
      if (bill.status !== 'POSTED') return bill.status;
      if (new Decimal(bill.paidTotal).greaterThanOrEqualTo(bill.total)) return 'PAID';
      if (bill.dueDate < this.today()) return 'OVERDUE';
      if (new Decimal(bill.paidTotal).greaterThan(0)) return 'PARTIAL';
      return 'POSTED';
    })();

    return {
      bill,
      partyName: await this.partyName(tx, bill.partyId),
      lines: await this.bills.linesOf(tx, bill.id),
      withholdings: await this.bills.withholdingsOf(tx, bill.id),
      outstanding,
      effectiveStatus,
    };
  }

  private async requireBill(tx: Tx, id: string): Promise<Bill> {
    const bill = await this.bills.byId(tx, id);
    if (!bill) throw AppError.notFound('Factura de proveedor');
    return bill;
  }

  private async build(
    tx: Tx,
    input: BillInput,
  ): Promise<{
    currency: string;
    lines: Omit<BillLine, 'id'>[];
    totals: ReturnType<typeof aggregateDocumentTotals>;
    withholdings: StoredWithholding[];
    withholdingTotal: Money;
  }> {
    if (input.lines.length === 0) {
      throw AppError.validation('Una factura necesita al menos una línea');
    }

    const ids = input.lines.map((l) => l.productId).filter((id): id is string => !!id);
    const products = await this.catalog().forPurchase(tx, ids);
    const currency = input.currencyCode ?? 'COP';

    const computed = input.lines.map((line, index) => {
      const product = line.productId ? products.get(line.productId) : undefined;
      if (line.productId && !product) {
        throw AppError.validation(`El producto de la línea ${index + 1} no existe`);
      }
      const description = line.description?.trim() || product?.name;
      if (!description) {
        throw AppError.validation(`La línea ${index + 1} necesita un producto o una descripción`);
      }
      // Una línea sin producto tiene que decir a qué cuenta va: si no, todo el
      // gasto acaba en una sola y el estado de resultados no dice nada.
      if (!line.productId && !line.accountId) {
        throw AppError.validation(
          `La línea "${description}" no es un producto: indica la cuenta de gasto o costo`,
        );
      }

      const taxes = product?.purchaseTax ? [product.purchaseTax] : [];
      const totals = computeLineTotals({
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discountPercent: line.discountPercent ?? '0',
        taxes,
        currency,
      });

      return {
        position: index + 1,
        productId: line.productId ?? null,
        accountId: line.accountId ?? null,
        description,
        quantity: new Decimal(line.quantity).toFixed(6),
        unitPrice: Money.of(line.unitPrice, currency).toDb(DB_DECIMALS),
        discountPercent: new Decimal(line.discountPercent ?? 0).toFixed(6),
        subtotal: totals.subtotal.toDb(DB_DECIMALS),
        taxTotal: totals.taxTotal.toDb(DB_DECIMALS),
        total: totals.total.toDb(DB_DECIMALS),
        taxes: totals.taxes.map((t) => ({
          taxId: t.taxId,
          code: t.code,
          kind: t.kind,
          rate: t.rate,
          base: t.base.toDb(DB_DECIMALS),
          amount: t.amount.toDb(DB_DECIMALS),
        })),
        computed: totals,
      };
    });

    const documentTotals = aggregateDocumentTotals(
      computed.map((c) => c.computed),
      currency,
    );

    // Las retenciones se calculan sobre el DOCUMENTO: la ley fija una base
    // mínima que una factura de muchas líneas supera aunque ninguna llegue.
    const defs =
      input.withholdingTaxIds && input.withholdingTaxIds.length > 0
        ? await this.withholdings().byIds(tx, input.withholdingTaxIds)
        : [];

    let withholdingTotal = Money.zero(currency);
    const stored: StoredWithholding[] = defs.map((def) => {
      const base =
        def.kind === 'WITHHOLDING_VAT' ? documentTotals.taxTotal : documentTotals.subtotal;
      const amount = base.percent(def.rate).round(DB_DECIMALS);
      withholdingTotal = withholdingTotal.plus(amount);
      return {
        taxId: def.id,
        code: def.code,
        name: def.code,
        kind: def.kind,
        rate: String(def.rate),
        base: base.toDb(DB_DECIMALS),
        amount: amount.toDb(DB_DECIMALS),
      };
    });

    return {
      currency,
      lines: computed.map(({ computed: _c, ...line }) => {
        void _c;
        return line;
      }),
      totals: documentTotals,
      withholdings: stored,
      withholdingTotal,
    };
  }

  private addDays(date: LocalDate, days: number): LocalDate {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  today(): LocalDate {
    return this.clock.now().toISOString().slice(0, 10);
  }
}

import { newId } from '@erp/core';
import type { ListQuery } from '@erp/contracts';
import type { Tx } from '../../../../platform/db/unitOfWork.js';
import type { ScopeFilter } from '../../../../platform/authz/scope.js';
import { runList, type ListResult, type ListSpec } from '../../../../platform/http/list.js';
import type {
  Payment,
  PaymentRepository,
  PaymentRow,
  Quote,
  QuoteRepository,
  QuoteRow,
} from '../../application/ports/SalesRepositories.js';

// ── Cotizaciones ─────────────────────────────────────────────────────────────

interface QuoteDbRow {
  id: string;
  organization_id: string;
  number: string;
  party_id: string;
  contact_id: string | null;
  status: string;
  issue_date: string;
  valid_until: string | null;
  currency_code: string;
  price_list_id: string | null;
  global_discount_percent: string;
  subtotal: string;
  discount_total: string;
  tax_total: string;
  total: string;
  notes: string | null;
  terms: string | null;
  converted_invoice_id: string | null;
  owner_membership_id: string | null;
  branch_id: string | null;
  created_at: Date;
}

const quoteFromRow = (r: QuoteDbRow): Quote => ({
  id: r.id,
  organizationId: r.organization_id,
  number: r.number,
  partyId: r.party_id,
  contactId: r.contact_id,
  status: r.status as Quote['status'],
  issueDate: r.issue_date,
  validUntil: r.valid_until,
  currencyCode: r.currency_code,
  priceListId: r.price_list_id,
  globalDiscountPercent: r.global_discount_percent,
  subtotal: r.subtotal,
  discountTotal: r.discount_total,
  taxTotal: r.tax_total,
  total: r.total,
  notes: r.notes,
  terms: r.terms,
  convertedInvoiceId: r.converted_invoice_id,
  ownerMembershipId: r.owner_membership_id,
  branchId: r.branch_id,
  createdAt: r.created_at,
});

const QUOTE_COLUMNS = `id, organization_id, number, party_id, contact_id, status,
  issue_date::text AS issue_date, valid_until::text AS valid_until, currency_code, price_list_id,
  global_discount_percent::text AS global_discount_percent, subtotal::text AS subtotal,
  discount_total::text AS discount_total, tax_total::text AS tax_total, total::text AS total,
  notes, terms, converted_invoice_id, owner_membership_id, branch_id, created_at`;

const quoteSpec = (): ListSpec => ({
  from: `FROM quotes q
         JOIN parties p ON p.id = q.party_id
         LEFT JOIN memberships m ON m.id = q.owner_membership_id
         LEFT JOIN users u ON u.id = m.user_id`,
  select: `q.id, q.number, q.status, q.issue_date::text AS issue_date,
           q.valid_until::text AS valid_until, q.total::text AS total, q.currency_code,
           q.converted_invoice_id, p.display_name AS party_name,
           (u.first_name || ' ' || u.last_name) AS owner_name`,
  fields: {
    number: { column: 'q.number', type: 'text', sortable: true, filterable: true, searchable: true },
    party_id: { column: 'q.party_id', type: 'uuid', sortable: false, filterable: true },
    party_name: { column: 'p.display_name', type: 'text', sortable: true, filterable: true, searchable: true },
    status: { column: 'q.status', type: 'text', sortable: true, filterable: true },
    issue_date: { column: 'q.issue_date', type: 'date', sortable: true, filterable: true },
    valid_until: { column: 'q.valid_until', type: 'date', sortable: true, filterable: true },
    total: { column: 'q.total', type: 'number', sortable: true, filterable: true },
  },
  baseWhere: ['q.deleted_at IS NULL'],
  defaultSort: [{ field: 'issue_date', dir: 'desc' }],
  ownerColumn: 'q.owner_membership_id',
  branchColumn: 'q.branch_id',
  aggregates: {
    total_amount: 'coalesce(sum(q.total), 0)::text',
    accepted: `count(*) FILTER (WHERE q.status IN ('ACCEPTED','CONVERTED'))::int`,
    // Tasa de conversión: la cifra por la que se mira esta pantalla.
    converted: `count(*) FILTER (WHERE q.status = 'CONVERTED')::int`,
  },
});

export class PgQuoteRepository implements QuoteRepository {
  async findById(tx: Tx, id: string): Promise<Quote | null> {
    const { rows } = await tx.client.query<QuoteDbRow>(
      `SELECT ${QUOTE_COLUMNS} FROM quotes WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return rows[0] ? quoteFromRow(rows[0]) : null;
  }

  async list(tx: Tx, query: ListQuery, scope: ScopeFilter): Promise<ListResult<QuoteRow>> {
    return runList<QuoteRow>(tx, quoteSpec(), query, scope);
  }

  async save(tx: Tx, q: Quote): Promise<void> {
    await tx.client.query(
      `INSERT INTO quotes (id, organization_id, number, party_id, contact_id, status, issue_date,
         valid_until, currency_code, price_list_id, global_discount_percent, subtotal, discount_total,
         tax_total, total, notes, terms, converted_invoice_id, owner_membership_id, branch_id,
         created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8::date,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$19,$21)`,
      [
        q.id, q.organizationId, q.number, q.partyId, q.contactId, q.status, q.issueDate, q.validUntil,
        q.currencyCode, q.priceListId, q.globalDiscountPercent, q.subtotal, q.discountTotal,
        q.taxTotal, q.total, q.notes, q.terms, q.convertedInvoiceId, q.ownerMembershipId, q.branchId,
        q.createdAt,
      ],
    );
  }

  async update(tx: Tx, q: Quote): Promise<void> {
    await tx.client.query(
      `UPDATE quotes SET party_id = $2, contact_id = $3, status = $4, issue_date = $5::date,
         valid_until = $6::date, currency_code = $7, price_list_id = $8, global_discount_percent = $9,
         subtotal = $10, discount_total = $11, tax_total = $12, total = $13, notes = $14, terms = $15,
         converted_invoice_id = $16, owner_membership_id = $17, branch_id = $18
       WHERE id = $1`,
      [
        q.id, q.partyId, q.contactId, q.status, q.issueDate, q.validUntil, q.currencyCode,
        q.priceListId, q.globalDiscountPercent, q.subtotal, q.discountTotal, q.taxTotal, q.total,
        q.notes, q.terms, q.convertedInvoiceId, q.ownerMembershipId, q.branchId,
      ],
    );
  }

  async softDelete(tx: Tx, id: string, at: Date): Promise<void> {
    await tx.client.query('UPDATE quotes SET deleted_at = $2 WHERE id = $1', [id, at]);
  }
}

// ── Pagos ────────────────────────────────────────────────────────────────────

interface PaymentDbRow {
  id: string;
  organization_id: string;
  number: string | null;
  party_id: string;
  direction: string;
  payment_date: string;
  method: string;
  currency_code: string;
  amount: string;
  allocated_total: string;
  reference: string | null;
  notes: string | null;
  voided_at: Date | null;
  void_reason: string | null;
  created_at: Date;
}

const paymentFromRow = (r: PaymentDbRow): Payment => ({
  id: r.id,
  organizationId: r.organization_id,
  number: r.number,
  partyId: r.party_id,
  direction: r.direction as Payment['direction'],
  paymentDate: r.payment_date,
  method: r.method as Payment['method'],
  currencyCode: r.currency_code,
  amount: r.amount,
  allocatedTotal: r.allocated_total,
  reference: r.reference,
  notes: r.notes,
  voidedAt: r.voided_at,
  voidReason: r.void_reason,
  createdAt: r.created_at,
});

const PAYMENT_COLUMNS = `id, organization_id, number, party_id, direction,
  payment_date::text AS payment_date, method, currency_code, amount::text AS amount,
  allocated_total::text AS allocated_total, reference, notes, voided_at, void_reason, created_at`;

const paymentSpec = (): ListSpec => ({
  from: `FROM payments pm JOIN parties p ON p.id = pm.party_id`,
  select: `pm.id, pm.number, pm.payment_date::text AS payment_date, pm.method,
           pm.amount::text AS amount, pm.allocated_total::text AS allocated_total,
           (pm.amount - pm.allocated_total)::text AS unapplied, pm.currency_code, pm.reference,
           pm.voided_at, p.display_name AS party_name`,
  fields: {
    number: { column: 'pm.number', type: 'text', sortable: true, filterable: true, searchable: true },
    party_id: { column: 'pm.party_id', type: 'uuid', sortable: false, filterable: true },
    party_name: { column: 'p.display_name', type: 'text', sortable: true, filterable: true, searchable: true },
    payment_date: { column: 'pm.payment_date', type: 'date', sortable: true, filterable: true },
    method: { column: 'pm.method', type: 'text', sortable: true, filterable: true },
    direction: { column: 'pm.direction', type: 'text', sortable: false, filterable: true },
    amount: { column: 'pm.amount', type: 'number', sortable: true, filterable: true },
    reference: { column: 'pm.reference', type: 'text', sortable: false, filterable: true, searchable: true },
    // Sin imputar: el dinero que entró y no se sabe a qué factura corresponde.
    unapplied: { column: '(pm.amount - pm.allocated_total)', type: 'number', sortable: true, filterable: true },
  },
  defaultSort: [{ field: 'payment_date', dir: 'desc' }],
  aggregates: {
    total_amount: 'coalesce(sum(pm.amount) FILTER (WHERE pm.voided_at IS NULL), 0)::text',
    unapplied_amount:
      'coalesce(sum(pm.amount - pm.allocated_total) FILTER (WHERE pm.voided_at IS NULL), 0)::text',
  },
});

export class PgPaymentRepository implements PaymentRepository {
  async findById(tx: Tx, id: string): Promise<Payment | null> {
    const { rows } = await tx.client.query<PaymentDbRow>(
      `SELECT ${PAYMENT_COLUMNS} FROM payments WHERE id = $1`,
      [id],
    );
    return rows[0] ? paymentFromRow(rows[0]) : null;
  }

  async list(tx: Tx, query: ListQuery): Promise<ListResult<PaymentRow>> {
    return runList<PaymentRow>(tx, paymentSpec(), query, {});
  }

  async save(tx: Tx, p: Payment): Promise<void> {
    await tx.client.query(
      `INSERT INTO payments (id, organization_id, number, party_id, direction, payment_date, method,
         currency_code, amount, allocated_total, reference, notes, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6::date,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        p.id, p.organizationId, p.number, p.partyId, p.direction, p.paymentDate, p.method,
        p.currencyCode, p.amount, p.allocatedTotal, p.reference, p.notes, null, p.createdAt,
      ],
    );
  }

  async update(tx: Tx, p: Payment): Promise<void> {
    await tx.client.query(
      `UPDATE payments SET number = $2, payment_date = $3::date, method = $4, amount = $5,
         allocated_total = $6, reference = $7, notes = $8, voided_at = $9, void_reason = $10
       WHERE id = $1`,
      [p.id, p.number, p.paymentDate, p.method, p.amount, p.allocatedTotal, p.reference, p.notes,
       p.voidedAt, p.voidReason],
    );
  }

  async allocations(
    tx: Tx,
    paymentId: string,
  ): Promise<Array<{ invoiceId: string; number: string | null; amount: string }>> {
    const { rows } = await tx.client.query<{ invoice_id: string; number: string | null; amount: string }>(
      `SELECT a.invoice_id, i.number, a.amount::text AS amount
         FROM payment_allocations a JOIN invoices i ON i.id = a.invoice_id
        WHERE a.payment_id = $1 ORDER BY i.due_date`,
      [paymentId],
    );
    return rows.map((r) => ({ invoiceId: r.invoice_id, number: r.number, amount: r.amount }));
  }

  async allocationsForInvoice(
    tx: Tx,
    invoiceId: string,
  ): Promise<Array<{ paymentId: string; number: string | null; paymentDate: string; amount: string }>> {
    const { rows } = await tx.client.query<{
      payment_id: string;
      number: string | null;
      payment_date: string;
      amount: string;
    }>(
      // Los pagos anulados se excluyen: si siguieran apareciendo, la suma de la
      // ficha no cuadraría con el saldo de la factura.
      `SELECT a.payment_id, pm.number, pm.payment_date::text AS payment_date, a.amount::text AS amount
         FROM payment_allocations a JOIN payments pm ON pm.id = a.payment_id
        WHERE a.invoice_id = $1 AND pm.voided_at IS NULL
        ORDER BY pm.payment_date`,
      [invoiceId],
    );
    return rows.map((r) => ({
      paymentId: r.payment_id,
      number: r.number,
      paymentDate: r.payment_date,
      amount: r.amount,
    }));
  }

  async replaceAllocations(
    tx: Tx,
    organizationId: string,
    paymentId: string,
    lines: ReadonlyArray<{ invoiceId: string; amount: string }>,
  ): Promise<void> {
    await tx.client.query('DELETE FROM payment_allocations WHERE payment_id = $1', [paymentId]);
    for (const line of lines) {
      await tx.client.query(
        `INSERT INTO payment_allocations (id, organization_id, payment_id, invoice_id, amount)
         VALUES ($1,$2,$3,$4,$5)`,
        [newId(), organizationId, paymentId, line.invoiceId, line.amount],
      );
    }
    // `allocated_total` se recalcula desde las filas, nunca se acumula: un
    // contador incremental se descuadra en cuanto se reimputa un pago.
    await tx.client.query(
      `UPDATE payments SET allocated_total =
         (SELECT coalesce(sum(amount), 0) FROM payment_allocations WHERE payment_id = $1)
       WHERE id = $1`,
      [paymentId],
    );
  }
}

import { newId } from '@erp/core';
import type { ListQuery } from '@erp/contracts';
import type { Tx } from '../../../../platform/db/unitOfWork.js';
import type { ScopeFilter } from '../../../../platform/authz/scope.js';
import { runList, type ListResult, type ListSpec } from '../../../../platform/http/list.js';
import type {
  AgingRow,
  Invoice,
  InvoiceRepository,
  InvoiceRow,
  LineRepository,
  SalesOverview,
  StoredLine,
  StoredWithholding,
  WithholdingRepository,
} from '../../application/ports/SalesRepositories.js';

interface InvoiceDbRow {
  id: string;
  organization_id: string;
  number: string | null;
  party_id: string;
  quote_id: string | null;
  status: string;
  issue_date: string;
  due_date: string;
  payment_terms_days: number;
  currency_code: string;
  exchange_rate: string;
  price_list_id: string | null;
  global_discount_percent: string;
  subtotal: string;
  discount_total: string;
  tax_total: string;
  total: string;
  withholding_total: string;
  net_payable: string;
  paid_total: string;
  notes: string | null;
  terms: string | null;
  dian_resolution: string | null;
  issued_at: Date | null;
  voided_at: Date | null;
  void_reason: string | null;
  owner_membership_id: string | null;
  branch_id: string | null;
  created_at: Date;
}

const fromRow = (r: InvoiceDbRow): Invoice => ({
  id: r.id,
  organizationId: r.organization_id,
  number: r.number,
  partyId: r.party_id,
  quoteId: r.quote_id,
  status: r.status as Invoice['status'],
  issueDate: r.issue_date,
  dueDate: r.due_date,
  paymentTermsDays: r.payment_terms_days,
  currencyCode: r.currency_code,
  exchangeRate: r.exchange_rate,
  priceListId: r.price_list_id,
  globalDiscountPercent: r.global_discount_percent,
  subtotal: r.subtotal,
  discountTotal: r.discount_total,
  taxTotal: r.tax_total,
  total: r.total,
  withholdingTotal: r.withholding_total,
  netPayable: r.net_payable,
  paidTotal: r.paid_total,
  notes: r.notes,
  terms: r.terms,
  dianResolution: r.dian_resolution,
  issuedAt: r.issued_at,
  voidedAt: r.voided_at,
  voidReason: r.void_reason,
  ownerMembershipId: r.owner_membership_id,
  branchId: r.branch_id,
  createdAt: r.created_at,
});

// Las fechas van con `::text`: un `date` convertido por el driver se interpreta
// en la zona del servidor, y una factura del 1 de marzo pasaría a ser del 28 de
// febrero en Colombia.
const COLUMNS = `id, organization_id, number, party_id, quote_id, status,
  issue_date::text AS issue_date, due_date::text AS due_date, payment_terms_days, currency_code,
  exchange_rate::text AS exchange_rate, price_list_id,
  global_discount_percent::text AS global_discount_percent,
  subtotal::text AS subtotal, discount_total::text AS discount_total, tax_total::text AS tax_total,
  total::text AS total, withholding_total::text AS withholding_total,
  net_payable::text AS net_payable, paid_total::text AS paid_total,
  notes, terms, dian_resolution, issued_at, voided_at, void_reason,
  owner_membership_id, branch_id, created_at`;

/**
 * Estado efectivo de una factura, calculado en SQL.
 *
 * Se deriva aquí y no en el servidor de aplicación porque el listado ordena y
 * filtra por él: traer todas las filas para clasificarlas en memoria rompería la
 * paginación en cuanto haya más facturas que una página.
 */
const EFFECTIVE_STATUS = `CASE
  WHEN i.status = 'VOID' THEN 'VOID'
  WHEN i.status = 'DRAFT' THEN 'DRAFT'
  WHEN i.paid_total >= i.total AND i.total > 0 THEN 'PAID'
  WHEN i.due_date < $TODAY THEN 'OVERDUE'
  WHEN i.paid_total > 0 THEN 'PARTIALLY_PAID'
  ELSE 'ISSUED'
END`;

const listSpec = (today: string): ListSpec => {
  const effective = EFFECTIVE_STATUS.replace('$TODAY', '$1::date');
  return {
    from: `FROM invoices i
           JOIN parties p ON p.id = i.party_id
           LEFT JOIN memberships m ON m.id = i.owner_membership_id
           LEFT JOIN users u ON u.id = m.user_id`,
    select: `i.id, i.number, i.party_id, i.status, i.issue_date::text AS issue_date,
             i.due_date::text AS due_date, i.total::text AS total, i.paid_total::text AS paid_total,
             (i.total - i.paid_total)::text AS outstanding, i.currency_code,
             p.display_name AS party_name, p.tax_id AS party_tax_id,
             (u.first_name || ' ' || u.last_name) AS owner_name,
             ${effective} AS effective_status,
             GREATEST(0, ($1::date - i.due_date))::int AS days_overdue`,
    fields: {
      number: { column: 'i.number', type: 'text', sortable: true, filterable: true, searchable: true },
      party_id: { column: 'i.party_id', type: 'uuid', sortable: false, filterable: true },
      party_name: { column: 'p.display_name', type: 'text', sortable: true, filterable: true, searchable: true },
      party_tax_id: { column: 'p.tax_id', type: 'text', sortable: false, filterable: true, searchable: true },
      status: { column: 'i.status', type: 'text', sortable: true, filterable: true },
      // Filtrar por el estado efectivo es lo que hace útil la pantalla: "muéstrame
      // lo vencido" no se puede responder con la columna almacenada.
      effective_status: { column: effective, type: 'text', sortable: true, filterable: true },
      issue_date: { column: 'i.issue_date', type: 'date', sortable: true, filterable: true },
      due_date: { column: 'i.due_date', type: 'date', sortable: true, filterable: true },
      total: { column: 'i.total', type: 'number', sortable: true, filterable: true },
      outstanding: { column: '(i.total - i.paid_total)', type: 'number', sortable: true, filterable: true },
    },
    baseParams: [today],
    defaultSort: [{ field: 'issue_date', dir: 'desc' }],
    ownerColumn: 'i.owner_membership_id',
    branchColumn: 'i.branch_id',
    aggregates: {
      total_amount: 'coalesce(sum(i.total), 0)::text',
      outstanding_amount: `coalesce(sum(i.total - i.paid_total) FILTER (WHERE i.status = 'ISSUED'), 0)::text`,
      overdue_count: `count(*) FILTER (WHERE i.status = 'ISSUED' AND i.paid_total < i.total AND i.due_date < $1::date)::int`,
    },
  };
};

export class PgInvoiceRepository implements InvoiceRepository {
  async findById(tx: Tx, id: string): Promise<Invoice | null> {
    const { rows } = await tx.client.query<InvoiceDbRow>(`SELECT ${COLUMNS} FROM invoices WHERE id = $1`, [id]);
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async findByNumber(tx: Tx, organizationId: string, number: string): Promise<Invoice | null> {
    const { rows } = await tx.client.query<InvoiceDbRow>(
      `SELECT ${COLUMNS} FROM invoices WHERE organization_id = $1 AND number = $2`,
      [organizationId, number],
    );
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async list(tx: Tx, query: ListQuery, scope: ScopeFilter, today: string): Promise<ListResult<InvoiceRow>> {
    return runList<InvoiceRow>(tx, listSpec(today), query, scope);
  }

  async save(tx: Tx, i: Invoice): Promise<void> {
    await tx.client.query(
      `INSERT INTO invoices (id, organization_id, number, party_id, quote_id, status, issue_date, due_date,
         payment_terms_days, currency_code, exchange_rate, price_list_id, global_discount_percent,
         subtotal, discount_total, tax_total, total, withholding_total, net_payable, paid_total,
         notes, terms, dian_resolution, issued_at, voided_at, void_reason,
         owner_membership_id, branch_id, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8::date,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
               $21,$22,$23,$24,$25,$26,$27,$28,$27,$29)`,
      [
        i.id, i.organizationId, i.number, i.partyId, i.quoteId, i.status, i.issueDate, i.dueDate,
        i.paymentTermsDays, i.currencyCode, i.exchangeRate, i.priceListId, i.globalDiscountPercent,
        i.subtotal, i.discountTotal, i.taxTotal, i.total, i.withholdingTotal, i.netPayable, i.paidTotal,
        i.notes, i.terms, i.dianResolution, i.issuedAt, i.voidedAt, i.voidReason,
        i.ownerMembershipId, i.branchId, i.createdAt,
      ],
    );
  }

  async update(tx: Tx, i: Invoice): Promise<void> {
    await tx.client.query(
      `UPDATE invoices SET number = $2, party_id = $3, status = $4, issue_date = $5::date,
         due_date = $6::date, payment_terms_days = $7, currency_code = $8, exchange_rate = $9,
         price_list_id = $10, global_discount_percent = $11, subtotal = $12, discount_total = $13,
         tax_total = $14, total = $15, withholding_total = $16, net_payable = $17, paid_total = $18,
         notes = $19, terms = $20, dian_resolution = $21, issued_at = $22, voided_at = $23,
         void_reason = $24, owner_membership_id = $25, branch_id = $26
       WHERE id = $1`,
      [
        i.id, i.number, i.partyId, i.status, i.issueDate, i.dueDate, i.paymentTermsDays, i.currencyCode,
        i.exchangeRate, i.priceListId, i.globalDiscountPercent, i.subtotal, i.discountTotal, i.taxTotal,
        i.total, i.withholdingTotal, i.netPayable, i.paidTotal, i.notes, i.terms, i.dianResolution,
        i.issuedAt, i.voidedAt, i.voidReason, i.ownerMembershipId, i.branchId,
      ],
    );
  }

  /** Solo se borran borradores; una factura emitida se anula. */
  async delete(tx: Tx, id: string): Promise<void> {
    await tx.client.query(`DELETE FROM invoices WHERE id = $1 AND status = 'DRAFT'`, [id]);
  }

  async openForParty(tx: Tx, organizationId: string, partyId: string): Promise<Invoice[]> {
    const { rows } = await tx.client.query<InvoiceDbRow>(
      `SELECT ${COLUMNS} FROM invoices
        WHERE organization_id = $1 AND party_id = $2 AND status = 'ISSUED' AND paid_total < total
        ORDER BY due_date, issue_date`,
      [organizationId, partyId],
    );
    return rows.map(fromRow);
  }

  /**
   * Recalcula lo pagado sumando las imputaciones vigentes.
   *
   * Suma desde `payment_allocations` en vez de ir acumulando en la factura: un
   * contador que se incrementa se descuadra en cuanto un pago se anula o se
   * reimputa, y el error no se ve hasta que alguien cuadra la cartera.
   */
  async recalculatePaid(tx: Tx, invoiceId: string): Promise<string> {
    const { rows } = await tx.client.query<{ paid_total: string }>(
      `UPDATE invoices SET paid_total = (
         SELECT coalesce(sum(a.amount), 0) FROM payment_allocations a
           JOIN payments pm ON pm.id = a.payment_id
          WHERE a.invoice_id = $1 AND pm.voided_at IS NULL
       ) WHERE id = $1
       RETURNING paid_total::text AS paid_total`,
      [invoiceId],
    );
    return rows[0]?.paid_total ?? '0';
  }

  async aging(tx: Tx, organizationId: string, today: string, scope: ScopeFilter): Promise<AgingRow[]> {
    const conditions = [`i.organization_id = $1`, `i.status = 'ISSUED'`, `i.paid_total < i.total`];
    const params: unknown[] = [organizationId, today];

    if (scope.ownerMembershipId) {
      params.push(scope.ownerMembershipId);
      conditions.push(`i.owner_membership_id = $${params.length}::uuid`);
    } else if (scope.ownerMembershipIdIn) {
      params.push(scope.ownerMembershipIdIn);
      conditions.push(`i.owner_membership_id = ANY($${params.length}::uuid[])`);
    }

    const bucket = (from: number | null, to: number | null): string => {
      const days = `($2::date - i.due_date)`;
      if (from === null) return `${days} <= 0`;
      return to === null ? `${days} > ${from}` : `${days} BETWEEN ${from} AND ${to}`;
    };
    const sum = (cond: string): string =>
      `coalesce(sum(i.total - i.paid_total) FILTER (WHERE ${cond}), 0)::text`;

    const { rows } = await tx.client.query<{
      party_id: string;
      party_name: string;
      current: string;
      d1_30: string;
      d31_60: string;
      d61_90: string;
      d90_plus: string;
      total: string;
    }>(
      `SELECT i.party_id, p.display_name AS party_name,
              ${sum(bucket(null, null))} AS current,
              ${sum(bucket(1, 30))} AS d1_30,
              ${sum(bucket(31, 60))} AS d31_60,
              ${sum(bucket(61, 90))} AS d61_90,
              ${sum(bucket(90, null))} AS d90_plus,
              coalesce(sum(i.total - i.paid_total), 0)::text AS total
         FROM invoices i JOIN parties p ON p.id = i.party_id
        WHERE ${conditions.join(' AND ')}
        GROUP BY i.party_id, p.display_name
        ORDER BY sum(i.total - i.paid_total) DESC`,
      params,
    );

    return rows.map((r) => ({
      partyId: r.party_id,
      partyName: r.party_name,
      current: r.current,
      d1_30: r.d1_30,
      d31_60: r.d31_60,
      d61_90: r.d61_90,
      d90_plus: r.d90_plus,
      total: r.total,
    }));
  }

  async overview(tx: Tx, organizationId: string, today: string, scope: ScopeFilter): Promise<SalesOverview> {
    const conditions = ['organization_id = $1'];
    const params: unknown[] = [organizationId, today];

    if (scope.ownerMembershipId) {
      params.push(scope.ownerMembershipId);
      conditions.push(`owner_membership_id = $${params.length}::uuid`);
    } else if (scope.ownerMembershipIdIn) {
      params.push(scope.ownerMembershipIdIn);
      conditions.push(`owner_membership_id = ANY($${params.length}::uuid[])`);
    }

    const { rows } = await tx.client.query<Record<string, string>>(
      `SELECT
         count(*) FILTER (WHERE status = 'DRAFT')::text AS draft_count,
         count(*) FILTER (WHERE status = 'ISSUED')::text AS issued_count,
         count(*) FILTER (WHERE status = 'ISSUED' AND paid_total < total AND due_date < $2::date)::text
           AS overdue_count,
         coalesce(sum(total - paid_total) FILTER (WHERE status = 'ISSUED'), 0)::text AS outstanding,
         coalesce(sum(total - paid_total)
           FILTER (WHERE status = 'ISSUED' AND due_date < $2::date), 0)::text AS overdue_amount,
         coalesce(sum(total)
           FILTER (WHERE status = 'ISSUED'
                     AND issue_date >= date_trunc('month', $2::date)), 0)::text AS issued_this_month,
         coalesce(sum(paid_total)
           FILTER (WHERE status = 'ISSUED'
                     AND issue_date >= date_trunc('month', $2::date)), 0)::text AS collected_this_month
       FROM invoices WHERE ${conditions.join(' AND ')}`,
      params,
    );

    const r = rows[0] ?? {};
    return {
      draftCount: Number(r.draft_count ?? 0),
      issuedCount: Number(r.issued_count ?? 0),
      overdueCount: Number(r.overdue_count ?? 0),
      outstanding: r.outstanding ?? '0',
      overdueAmount: r.overdue_amount ?? '0',
      issuedThisMonth: r.issued_this_month ?? '0',
      collectedThisMonth: r.collected_this_month ?? '0',
    };
  }
}

/*
 * El "hoy" con el que se decide qué está vencido LLEGA COMO PARÁMETRO, del reloj
 * inyectado de la aplicación.
 *
 * La versión anterior lo tomaba de `current_date` de PostgreSQL, y eso metía un
 * segundo reloj en el sistema: el listado clasificaba con la fecha del servidor
 * de base de datos y la ficha con la de la aplicación, así que una factura podía
 * salir vencida en la lista y al día al abrirla. Además hacía imposible probar
 * la cartera con un reloj fijo, que es justo lo que un test de vencimientos
 * necesita.
 */

// ── Líneas e impuestos ───────────────────────────────────────────────────────

export class PgLineRepository implements LineRepository {
  async listFor(
    tx: Tx,
    parent: { quoteId?: string; invoiceId?: string; creditNoteId?: string },
  ): Promise<StoredLine[]> {
    const { column, value } = parentOf(parent);
    const { rows } = await tx.client.query<Record<string, string>>(
      `SELECT l.id, l.position, l.product_id, l.variant_id, l.description, l.sku, l.uom_code,
              l.quantity::text AS quantity, l.unit_price::text AS unit_price,
              l.discount_percent::text AS discount_percent, l.gross::text AS gross,
              l.discount_amount::text AS discount_amount, l.subtotal::text AS subtotal,
              l.tax_total::text AS tax_total, l.total::text AS total,
              coalesce(
                (SELECT json_agg(json_build_object(
                   'taxId', t.tax_id, 'code', t.code, 'kind', t.kind,
                   'rate', trim_scale(t.rate)::text, 'base', t.base::text, 'amount', t.amount::text
                 ) ORDER BY t.code)
                 FROM document_line_taxes t WHERE t.line_id = l.id), '[]'
              )::text AS taxes
         FROM document_lines l WHERE l.${column} = $1 ORDER BY l.position`,
      [value],
    );

    return rows.map((r) => ({
      id: r.id!,
      position: Number(r.position),
      productId: r.product_id ?? null,
      variantId: r.variant_id ?? null,
      description: r.description!,
      sku: r.sku ?? null,
      uomCode: r.uom_code ?? null,
      quantity: r.quantity!,
      unitPrice: r.unit_price!,
      discountPercent: r.discount_percent!,
      gross: r.gross!,
      discountAmount: r.discount_amount!,
      subtotal: r.subtotal!,
      taxTotal: r.tax_total!,
      total: r.total!,
      taxes: JSON.parse(r.taxes ?? '[]') as StoredLine['taxes'],
    }));
  }

  /**
   * Reemplaza TODAS las líneas del documento.
   *
   * Borrar y reinsertar en vez de calcular qué cambió: un documento tiene
   * decenas de líneas, no miles, y el diff incremental es donde se cuelan los
   * errores de posición que dejan una línea duplicada o perdida. El borrado en
   * cascada se lleva los impuestos de cada línea.
   */
  async replaceAll(
    tx: Tx,
    organizationId: string,
    parent: { quoteId?: string; invoiceId?: string; creditNoteId?: string },
    lines: readonly Omit<StoredLine, 'id'>[],
  ): Promise<void> {
    const { column, value } = parentOf(parent);
    await tx.client.query(`DELETE FROM document_lines WHERE ${column} = $1`, [value]);
    if (lines.length === 0) return;

    for (const line of lines) {
      const id = newId();
      await tx.client.query(
        `INSERT INTO document_lines (id, organization_id, ${column}, position, product_id, variant_id,
           description, sku, uom_code, quantity, unit_price, discount_percent,
           gross, discount_amount, subtotal, tax_total, total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [
          id, organizationId, value, line.position, line.productId, line.variantId,
          line.description, line.sku, line.uomCode, line.quantity, line.unitPrice, line.discountPercent,
          line.gross, line.discountAmount, line.subtotal, line.taxTotal, line.total,
        ],
      );

      for (const tax of line.taxes) {
        await tx.client.query(
          `INSERT INTO document_line_taxes (id, organization_id, line_id, tax_id, code, kind, rate, base, amount)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [newId(), organizationId, id, tax.taxId, tax.code, tax.kind, tax.rate, tax.base, tax.amount],
        );
      }
    }
  }
}

const parentOf = (parent: {
  quoteId?: string;
  invoiceId?: string;
  creditNoteId?: string;
}): { column: string; value: string } => {
  if (parent.quoteId) return { column: 'quote_id', value: parent.quoteId };
  if (parent.invoiceId) return { column: 'invoice_id', value: parent.invoiceId };
  if (parent.creditNoteId) return { column: 'credit_note_id', value: parent.creditNoteId };
  throw new Error('Una línea necesita exactamente un documento padre');
};

export class PgWithholdingRepository implements WithholdingRepository {
  async listFor(tx: Tx, invoiceId: string): Promise<StoredWithholding[]> {
    const { rows } = await tx.client.query<Record<string, string>>(
      `SELECT tax_id, code, name, kind, trim_scale(rate)::text AS rate,
              base::text AS base, amount::text AS amount
         FROM document_withholdings WHERE invoice_id = $1 ORDER BY code`,
      [invoiceId],
    );
    return rows.map((r) => ({
      taxId: r.tax_id ?? null,
      code: r.code!,
      name: r.name!,
      kind: r.kind!,
      rate: r.rate!,
      base: r.base!,
      amount: r.amount!,
    }));
  }

  async replaceAll(
    tx: Tx,
    organizationId: string,
    invoiceId: string,
    items: readonly StoredWithholding[],
  ): Promise<void> {
    await tx.client.query('DELETE FROM document_withholdings WHERE invoice_id = $1', [invoiceId]);
    for (const item of items) {
      await tx.client.query(
        `INSERT INTO document_withholdings (id, organization_id, invoice_id, tax_id, code, name, kind, rate, base, amount)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [newId(), organizationId, invoiceId, item.taxId, item.code, item.name, item.kind, item.rate, item.base, item.amount],
      );
    }
  }
}

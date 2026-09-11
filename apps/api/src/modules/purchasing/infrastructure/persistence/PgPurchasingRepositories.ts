import type { ListQuery } from '@erp/contracts';
import type { LocalDate } from '@erp/core';
import type { Tx } from '../../../../platform/db/unitOfWork.js';
import { runList, type ListResult, type ListSpec } from '../../../../platform/http/list.js';
import type {
  Bill,
  BillLine,
  BillRepository,
  GoodsReceipt,
  OrderLine,
  PayableRow,
  PurchaseOrder,
  PurchaseOrderRepository,
  PurchasingOverview,
  ReceiptLine,
  ReceiptRepository,
  StoredWithholding,
} from '../../application/ports/PurchasingRepositories.js';

// ── Órdenes de compra ────────────────────────────────────────────────────────

const ORDER_COLUMNS = `
  o.id, o.organization_id, o.number, o.party_id, o.warehouse_id, o.status,
  o.order_date::text AS order_date, o.expected_date::text AS expected_date,
  o.currency_code, trim_scale(o.exchange_rate)::text AS exchange_rate,
  o.subtotal::text AS subtotal, o.tax_total::text AS tax_total, o.total::text AS total,
  o.notes, o.terms, o.owner_membership_id, o.branch_id`;

interface OrderDbRow {
  id: string;
  organization_id: string;
  number: string | null;
  party_id: string;
  warehouse_id: string | null;
  status: string;
  order_date: string;
  expected_date: string | null;
  currency_code: string;
  exchange_rate: string;
  subtotal: string;
  tax_total: string;
  total: string;
  notes: string | null;
  terms: string | null;
  owner_membership_id: string | null;
  branch_id: string | null;
}

const orderFrom = (r: OrderDbRow): PurchaseOrder => ({
  id: r.id,
  organizationId: r.organization_id,
  number: r.number,
  partyId: r.party_id,
  warehouseId: r.warehouse_id,
  status: r.status as PurchaseOrder['status'],
  orderDate: r.order_date,
  expectedDate: r.expected_date,
  currencyCode: r.currency_code,
  exchangeRate: r.exchange_rate,
  subtotal: r.subtotal,
  taxTotal: r.tax_total,
  total: r.total,
  notes: r.notes,
  terms: r.terms,
  ownerMembershipId: r.owner_membership_id,
  branchId: r.branch_id,
});

export class PgPurchaseOrderRepository implements PurchaseOrderRepository {
  async list(tx: Tx, query: ListQuery): Promise<ListResult<Record<string, unknown>>> {
    const spec: ListSpec = {
      from: `
        FROM purchase_orders o
        JOIN parties pa ON pa.id = o.party_id
        LEFT JOIN warehouses w ON w.id = o.warehouse_id`,
      select: `
        o.id, o.number, o.order_date::text AS order_date, o.expected_date::text AS expected_date,
        o.status, o.party_id, pa.display_name AS party_name, pa.tax_id AS party_tax_id,
        w.name AS warehouse_name, o.currency_code, o.total::text AS total,
        -- Porcentaje recibido: es lo que se mira para saber qué reclamar.
        COALESCE((SELECT round(100 * sum(l.received) / NULLIF(sum(l.quantity), 0))
                    FROM purchase_order_lines l WHERE l.order_id = o.id), 0)::int
          AS received_percent`,
      fields: {
        number: { column: 'o.number', type: 'text', sortable: true, filterable: true, searchable: true },
        party_name: { column: 'pa.display_name', type: 'text', sortable: true, filterable: true, searchable: true },
        party_tax_id: { column: 'pa.tax_id', type: 'text', filterable: true, searchable: true },
        order_date: { column: 'o.order_date', type: 'date', sortable: true, filterable: true },
        expected_date: { column: 'o.expected_date', type: 'date', sortable: true, filterable: true },
        status: { column: 'o.status', type: 'text', sortable: true, filterable: true },
        total: { column: 'o.total', type: 'number', sortable: true, filterable: true },
      },
      baseWhere: ['o.deleted_at IS NULL'],
      defaultSort: [{ field: 'order_date', dir: 'desc' }],
      ownerColumn: 'o.owner_membership_id',
      branchColumn: 'o.branch_id',
      aggregates: {
        total_amount: 'COALESCE(SUM(o.total), 0)::text',
        open_count: "COUNT(*) FILTER (WHERE o.status IN ('SENT','PARTIAL'))::int",
      },
      countExpression: 'o.id',
    };
    return runList(tx, spec, query);
  }

  async byId(tx: Tx, id: string): Promise<PurchaseOrder | null> {
    const { rows } = await tx.client.query<OrderDbRow>(
      `SELECT ${ORDER_COLUMNS} FROM purchase_orders o WHERE o.id = $1 AND o.deleted_at IS NULL`,
      [id],
    );
    return rows[0] ? orderFrom(rows[0]) : null;
  }

  async linesOf(tx: Tx, orderId: string): Promise<OrderLine[]> {
    const { rows } = await tx.client.query<{
      id: string;
      position: number;
      product_id: string | null;
      description: string;
      sku: string | null;
      uom_code: string | null;
      quantity: string;
      received: string;
      pending: string;
      unit_price: string;
      discount_percent: string;
      tax_id: string | null;
      subtotal: string;
      tax_total: string;
      total: string;
    }>(
      `SELECT id, position, product_id, description, sku, uom_code,
              trim_scale(quantity)::text AS quantity, trim_scale(received)::text AS received,
              trim_scale(greatest(quantity - received, 0))::text AS pending,
              unit_price::text AS unit_price, trim_scale(discount_percent)::text AS discount_percent,
              tax_id, subtotal::text AS subtotal, tax_total::text AS tax_total, total::text AS total
         FROM purchase_order_lines WHERE order_id = $1 ORDER BY position`,
      [orderId],
    );
    return rows.map((r) => ({
      id: r.id,
      position: r.position,
      productId: r.product_id,
      description: r.description,
      sku: r.sku,
      uomCode: r.uom_code,
      quantity: r.quantity,
      received: r.received,
      pending: r.pending,
      unitPrice: r.unit_price,
      discountPercent: r.discount_percent,
      taxId: r.tax_id,
      subtotal: r.subtotal,
      taxTotal: r.tax_total,
      total: r.total,
    }));
  }

  async partyNameOf(tx: Tx, partyId: string): Promise<string> {
    const { rows } = await tx.client.query<{ display_name: string }>(
      'SELECT display_name FROM parties WHERE id = $1',
      [partyId],
    );
    return rows[0]?.display_name ?? 'Proveedor';
  }

  async save(tx: Tx, o: PurchaseOrder, createdBy: string | null): Promise<void> {
    await tx.client.query(
      `INSERT INTO purchase_orders
         (id, organization_id, number, party_id, warehouse_id, status, order_date, expected_date,
          currency_code, exchange_rate, subtotal, tax_total, total, notes, terms,
          owner_membership_id, branch_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::uuid)`,
      [
        o.id, o.organizationId, o.number, o.partyId, o.warehouseId, o.status, o.orderDate,
        o.expectedDate, o.currencyCode, o.exchangeRate, o.subtotal, o.taxTotal, o.total,
        o.notes, o.terms, o.ownerMembershipId, o.branchId, createdBy,
      ],
    );
  }

  async update(tx: Tx, o: PurchaseOrder): Promise<void> {
    await tx.client.query(
      `UPDATE purchase_orders SET number = $2, party_id = $3, warehouse_id = $4, status = $5,
              order_date = $6, expected_date = $7, currency_code = $8, exchange_rate = $9,
              subtotal = $10, tax_total = $11, total = $12, notes = $13, terms = $14,
              owner_membership_id = $15, branch_id = $16
        WHERE id = $1`,
      [
        o.id, o.number, o.partyId, o.warehouseId, o.status, o.orderDate, o.expectedDate,
        o.currencyCode, o.exchangeRate, o.subtotal, o.taxTotal, o.total, o.notes, o.terms,
        o.ownerMembershipId, o.branchId,
      ],
    );
  }

  async replaceLines(
    tx: Tx,
    organizationId: string,
    orderId: string,
    lines: readonly Omit<OrderLine, 'id' | 'received' | 'pending'>[],
  ): Promise<void> {
    await tx.client.query('DELETE FROM purchase_order_lines WHERE order_id = $1', [orderId]);
    if (lines.length === 0) return;
    await tx.client.query(
      `INSERT INTO purchase_order_lines
         (id, organization_id, order_id, position, product_id, description, sku, uom_code,
          quantity, unit_price, discount_percent, tax_id, subtotal, tax_total, total)
       SELECT gen_random_uuid(), $1, $2, position, product_id, description, sku, uom_code,
              quantity, unit_price, discount_percent, tax_id, subtotal, tax_total, total
         FROM unnest(
           $3::smallint[], $4::uuid[], $5::text[], $6::text[], $7::text[],
           $8::numeric[], $9::numeric[], $10::numeric[], $11::uuid[],
           $12::numeric[], $13::numeric[], $14::numeric[]
         ) AS t(position, product_id, description, sku, uom_code,
                quantity, unit_price, discount_percent, tax_id, subtotal, tax_total, total)`,
      [
        organizationId,
        orderId,
        lines.map((l) => l.position),
        lines.map((l) => l.productId),
        lines.map((l) => l.description),
        lines.map((l) => l.sku),
        lines.map((l) => l.uomCode),
        lines.map((l) => l.quantity),
        lines.map((l) => l.unitPrice),
        lines.map((l) => l.discountPercent),
        lines.map((l) => l.taxId),
        lines.map((l) => l.subtotal),
        lines.map((l) => l.taxTotal),
        lines.map((l) => l.total),
      ],
    );
  }

  /**
   * Recalcula lo recibido SUMANDO las recepciones contabilizadas.
   *
   * No incrementa: suma. Un contador que se acumula se descuadra en cuanto una
   * recepción se anula, y entonces la orden dice "recibida" con mercancía
   * pendiente; nadie reclama al proveedor y la mercancía nunca llega.
   */
  async recalculateReceived(tx: Tx, orderId: string): Promise<void> {
    await tx.client.query(
      `UPDATE purchase_order_lines l
          SET received = COALESCE((
                SELECT sum(rl.quantity)
                  FROM goods_receipt_lines rl
                  JOIN goods_receipts r ON r.id = rl.receipt_id
                 WHERE rl.order_line_id = l.id AND r.status = 'POSTED'
              ), 0)
        WHERE l.order_id = $1`,
      [orderId],
    );
  }

  async setStatus(tx: Tx, id: string, status: PurchaseOrder['status']): Promise<void> {
    await tx.client.query('UPDATE purchase_orders SET status = $2 WHERE id = $1', [id, status]);
  }

  async softDelete(tx: Tx, id: string): Promise<void> {
    await tx.client.query('UPDATE purchase_orders SET deleted_at = now() WHERE id = $1', [id]);
  }

  async overview(tx: Tx, today: LocalDate): Promise<PurchasingOverview> {
    const { rows } = await tx.client.query<{
      open_orders: number;
      late_orders: number;
      expected_this_week: string;
      payable: string;
      overdue_payable: string;
      overdue_bills: number;
    }>(
      `SELECT
         (SELECT count(*) FROM purchase_orders
           WHERE status IN ('SENT','PARTIAL') AND deleted_at IS NULL)::int AS open_orders,
         (SELECT count(*) FROM purchase_orders
           WHERE status IN ('SENT','PARTIAL') AND deleted_at IS NULL
             AND expected_date < $1::date)::int AS late_orders,
         (SELECT COALESCE(sum(total), 0) FROM purchase_orders
           WHERE status IN ('SENT','PARTIAL') AND deleted_at IS NULL
             AND expected_date BETWEEN $1::date AND $1::date + 7)::text AS expected_this_week,
         (SELECT COALESCE(sum(total - paid_total), 0) FROM bills
           WHERE status = 'POSTED' AND paid_total < total)::text AS payable,
         (SELECT COALESCE(sum(total - paid_total), 0) FROM bills
           WHERE status = 'POSTED' AND paid_total < total AND due_date < $1::date)::text
           AS overdue_payable,
         (SELECT count(*) FROM bills
           WHERE status = 'POSTED' AND paid_total < total AND due_date < $1::date)::int
           AS overdue_bills`,
      [today],
    );
    const r = rows[0];
    return {
      openOrders: r?.open_orders ?? 0,
      lateOrders: r?.late_orders ?? 0,
      expectedThisWeek: r?.expected_this_week ?? '0',
      payable: r?.payable ?? '0',
      overduePayable: r?.overdue_payable ?? '0',
      overdueBills: r?.overdue_bills ?? 0,
    };
  }
}

// ── Recepciones ──────────────────────────────────────────────────────────────

const RECEIPT_COLUMNS = `
  id, organization_id, number, party_id, order_id, warehouse_id, status,
  receipt_date::text AS receipt_date, reference, notes`;

export class PgReceiptRepository implements ReceiptRepository {
  async list(tx: Tx, query: ListQuery): Promise<ListResult<Record<string, unknown>>> {
    const spec: ListSpec = {
      from: `
        FROM goods_receipts r
        JOIN parties pa ON pa.id = r.party_id
        JOIN warehouses w ON w.id = r.warehouse_id
        LEFT JOIN purchase_orders o ON o.id = r.order_id`,
      select: `
        r.id, r.number, r.receipt_date::text AS receipt_date, r.status, r.reference,
        r.party_id, pa.display_name AS party_name, w.name AS warehouse_name,
        o.number AS order_number, r.order_id,
        (SELECT count(*) FROM goods_receipt_lines l WHERE l.receipt_id = r.id)::int AS line_count,
        (SELECT COALESCE(sum(l.quantity * l.unit_cost), 0) FROM goods_receipt_lines l
          WHERE l.receipt_id = r.id)::text AS total_cost`,
      fields: {
        number: { column: 'r.number', type: 'text', sortable: true, filterable: true, searchable: true },
        party_name: { column: 'pa.display_name', type: 'text', sortable: true, filterable: true, searchable: true },
        receipt_date: { column: 'r.receipt_date', type: 'date', sortable: true, filterable: true },
        status: { column: 'r.status', type: 'text', sortable: true, filterable: true },
        order_id: { column: 'r.order_id', type: 'uuid', filterable: true },
        reference: { column: 'r.reference', type: 'text', filterable: true, searchable: true },
      },
      defaultSort: [{ field: 'receipt_date', dir: 'desc' }],
      countExpression: 'r.id',
    };
    return runList(tx, spec, query);
  }

  async byId(tx: Tx, id: string): Promise<GoodsReceipt | null> {
    const { rows } = await tx.client.query<{
      id: string;
      organization_id: string;
      number: string | null;
      party_id: string;
      order_id: string | null;
      warehouse_id: string;
      status: string;
      receipt_date: string;
      reference: string | null;
      notes: string | null;
    }>(`SELECT ${RECEIPT_COLUMNS} FROM goods_receipts WHERE id = $1`, [id]);
    const r = rows[0];
    return r
      ? {
          id: r.id,
          organizationId: r.organization_id,
          number: r.number,
          partyId: r.party_id,
          orderId: r.order_id,
          warehouseId: r.warehouse_id,
          status: r.status as GoodsReceipt['status'],
          receiptDate: r.receipt_date,
          reference: r.reference,
          notes: r.notes,
        }
      : null;
  }

  async linesOf(tx: Tx, receiptId: string): Promise<ReceiptLine[]> {
    const { rows } = await tx.client.query<{
      id: string;
      position: number;
      order_line_id: string | null;
      product_id: string;
      lot_id: string | null;
      description: string;
      quantity: string;
      unit_cost: string;
    }>(
      `SELECT id, position, order_line_id, product_id, lot_id, description,
              trim_scale(quantity)::text AS quantity, unit_cost::text AS unit_cost
         FROM goods_receipt_lines WHERE receipt_id = $1 ORDER BY position`,
      [receiptId],
    );
    return rows.map((r) => ({
      id: r.id,
      position: r.position,
      orderLineId: r.order_line_id,
      productId: r.product_id,
      lotId: r.lot_id,
      description: r.description,
      quantity: r.quantity,
      unitCost: r.unit_cost,
    }));
  }

  async save(tx: Tx, r: GoodsReceipt, createdBy: string | null): Promise<void> {
    await tx.client.query(
      `INSERT INTO goods_receipts
         (id, organization_id, number, party_id, order_id, warehouse_id, status,
          receipt_date, reference, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::uuid)`,
      [
        r.id, r.organizationId, r.number, r.partyId, r.orderId, r.warehouseId, r.status,
        r.receiptDate, r.reference, r.notes, createdBy,
      ],
    );
  }

  async update(tx: Tx, r: GoodsReceipt): Promise<void> {
    await tx.client.query(
      `UPDATE goods_receipts SET party_id = $2, order_id = $3, warehouse_id = $4,
              receipt_date = $5, reference = $6, notes = $7
        WHERE id = $1 AND status = 'DRAFT'`,
      [r.id, r.partyId, r.orderId, r.warehouseId, r.receiptDate, r.reference, r.notes],
    );
  }

  async replaceLines(
    tx: Tx,
    organizationId: string,
    receiptId: string,
    lines: readonly Omit<ReceiptLine, 'id'>[],
  ): Promise<void> {
    await tx.client.query('DELETE FROM goods_receipt_lines WHERE receipt_id = $1', [receiptId]);
    if (lines.length === 0) return;
    await tx.client.query(
      `INSERT INTO goods_receipt_lines
         (id, organization_id, receipt_id, order_line_id, position, product_id, lot_id,
          description, quantity, unit_cost)
       SELECT gen_random_uuid(), $1, $2, order_line_id, position, product_id, lot_id,
              description, quantity, unit_cost
         FROM unnest($3::uuid[], $4::smallint[], $5::uuid[], $6::uuid[], $7::text[],
                     $8::numeric[], $9::numeric[])
              AS t(order_line_id, position, product_id, lot_id, description, quantity, unit_cost)`,
      [
        organizationId,
        receiptId,
        lines.map((l) => l.orderLineId),
        lines.map((l) => l.position),
        lines.map((l) => l.productId),
        lines.map((l) => l.lotId),
        lines.map((l) => l.description),
        lines.map((l) => l.quantity),
        lines.map((l) => l.unitCost),
      ],
    );
  }

  async post(tx: Tx, id: string, number: string): Promise<void> {
    await tx.client.query(
      `UPDATE goods_receipts SET status = 'POSTED', number = $2, posted_at = now()
        WHERE id = $1 AND status = 'DRAFT'`,
      [id, number],
    );
  }

  async void(tx: Tx, id: string, reason: string): Promise<void> {
    await tx.client.query(
      `UPDATE goods_receipts SET status = 'VOID', voided_at = now(), void_reason = $2 WHERE id = $1`,
      [id, reason],
    );
  }

  async ofOrder(tx: Tx, orderId: string): Promise<GoodsReceipt[]> {
    const { rows } = await tx.client.query<{ id: string }>(
      "SELECT id FROM goods_receipts WHERE order_id = $1 AND status <> 'VOID' ORDER BY receipt_date",
      [orderId],
    );
    const out: GoodsReceipt[] = [];
    for (const row of rows) {
      const receipt = await this.byId(tx, row.id);
      if (receipt) out.push(receipt);
    }
    return out;
  }
}

// ── Facturas de proveedor ────────────────────────────────────────────────────

const BILL_COLUMNS = `
  b.id, b.organization_id, b.number, b.supplier_number, b.party_id, b.order_id, b.receipt_id,
  b.status, b.issue_date::text AS issue_date, b.due_date::text AS due_date, b.payment_terms_days,
  b.currency_code, trim_scale(b.exchange_rate)::text AS exchange_rate,
  b.subtotal::text AS subtotal, b.tax_total::text AS tax_total, b.total::text AS total,
  b.withholding_total::text AS withholding_total, b.net_payable::text AS net_payable,
  b.paid_total::text AS paid_total, b.notes, b.owner_membership_id, b.branch_id`;

interface BillDbRow {
  id: string;
  organization_id: string;
  number: string | null;
  supplier_number: string;
  party_id: string;
  order_id: string | null;
  receipt_id: string | null;
  status: string;
  issue_date: string;
  due_date: string;
  payment_terms_days: number;
  currency_code: string;
  exchange_rate: string;
  subtotal: string;
  tax_total: string;
  total: string;
  withholding_total: string;
  net_payable: string;
  paid_total: string;
  notes: string | null;
  owner_membership_id: string | null;
  branch_id: string | null;
}

const billFrom = (r: BillDbRow): Bill => ({
  id: r.id,
  organizationId: r.organization_id,
  number: r.number,
  supplierNumber: r.supplier_number,
  partyId: r.party_id,
  orderId: r.order_id,
  receiptId: r.receipt_id,
  status: r.status as Bill['status'],
  issueDate: r.issue_date,
  dueDate: r.due_date,
  paymentTermsDays: r.payment_terms_days,
  currencyCode: r.currency_code,
  exchangeRate: r.exchange_rate,
  subtotal: r.subtotal,
  taxTotal: r.tax_total,
  total: r.total,
  withholdingTotal: r.withholding_total,
  netPayable: r.net_payable,
  paidTotal: r.paid_total,
  notes: r.notes,
  ownerMembershipId: r.owner_membership_id,
  branchId: r.branch_id,
});

export class PgBillRepository implements BillRepository {
  /**
   * `today` llega como parámetro, no como `current_date`.
   *
   * Es el mismo reloj que usa la ficha. Con dos relojes distintos —el de
   * PostgreSQL en el listado y el de la aplicación en el detalle— una factura
   * aparece vencida en una pantalla y al día en la otra, y nadie sabe cuál
   * creer.
   */
  async list(tx: Tx, query: ListQuery, today: LocalDate): Promise<ListResult<Record<string, unknown>>> {
    const spec: ListSpec = {
      from: 'FROM bills b JOIN parties pa ON pa.id = b.party_id',
      select: `
        b.id, b.number, b.supplier_number, b.issue_date::text AS issue_date,
        b.due_date::text AS due_date, b.status, b.party_id, pa.display_name AS party_name,
        pa.tax_id AS party_tax_id, b.currency_code,
        b.total::text AS total, b.paid_total::text AS paid_total,
        (b.total - b.paid_total)::text AS outstanding,
        GREATEST(($1::date - b.due_date), 0)::int AS days_overdue,
        CASE
          WHEN b.status <> 'POSTED' THEN b.status
          WHEN b.paid_total >= b.total THEN 'PAID'
          WHEN b.due_date < $1::date THEN 'OVERDUE'
          WHEN b.paid_total > 0 THEN 'PARTIAL'
          ELSE 'POSTED'
        END AS effective_status`,
      fields: {
        number: { column: 'b.number', type: 'text', sortable: true, filterable: true, searchable: true },
        supplier_number: {
          column: 'b.supplier_number',
          type: 'text',
          sortable: true,
          filterable: true,
          searchable: true,
        },
        party_name: { column: 'pa.display_name', type: 'text', sortable: true, filterable: true, searchable: true },
        party_tax_id: { column: 'pa.tax_id', type: 'text', filterable: true, searchable: true },
        issue_date: { column: 'b.issue_date', type: 'date', sortable: true, filterable: true },
        due_date: { column: 'b.due_date', type: 'date', sortable: true, filterable: true },
        status: { column: 'b.status', type: 'text', filterable: true },
        total: { column: 'b.total', type: 'number', sortable: true, filterable: true },
        outstanding: { column: '(b.total - b.paid_total)', type: 'number', sortable: true, filterable: true },
        effective_status: {
          column: `CASE
            WHEN b.status <> 'POSTED' THEN b.status
            WHEN b.paid_total >= b.total THEN 'PAID'
            WHEN b.due_date < $1::date THEN 'OVERDUE'
            WHEN b.paid_total > 0 THEN 'PARTIAL'
            ELSE 'POSTED' END`,
          type: 'text',
          sortable: true,
          filterable: true,
        },
      },
      baseParams: [today],
      defaultSort: [{ field: 'due_date', dir: 'asc' }],
      ownerColumn: 'b.owner_membership_id',
      branchColumn: 'b.branch_id',
      aggregates: {
        total_amount: 'COALESCE(SUM(b.total), 0)::text',
        outstanding_amount: "COALESCE(SUM(b.total - b.paid_total) FILTER (WHERE b.status = 'POSTED'), 0)::text",
        overdue_count: "COUNT(*) FILTER (WHERE b.status = 'POSTED' AND b.paid_total < b.total AND b.due_date < $1::date)::int",
      },
      countExpression: 'b.id',
    };
    return runList(tx, spec, query);
  }

  async byId(tx: Tx, id: string): Promise<Bill | null> {
    const { rows } = await tx.client.query<BillDbRow>(
      `SELECT ${BILL_COLUMNS} FROM bills b WHERE b.id = $1`,
      [id],
    );
    return rows[0] ? billFrom(rows[0]) : null;
  }

  async bySupplierNumber(tx: Tx, partyId: string, supplierNumber: string): Promise<Bill | null> {
    const { rows } = await tx.client.query<BillDbRow>(
      `SELECT ${BILL_COLUMNS} FROM bills b
        WHERE b.party_id = $1 AND b.supplier_number = $2 AND b.status <> 'VOID'`,
      [partyId, supplierNumber],
    );
    return rows[0] ? billFrom(rows[0]) : null;
  }

  async linesOf(tx: Tx, billId: string): Promise<BillLine[]> {
    const { rows } = await tx.client.query<{
      id: string;
      position: number;
      product_id: string | null;
      account_id: string | null;
      description: string;
      quantity: string;
      unit_price: string;
      discount_percent: string;
      subtotal: string;
      tax_total: string;
      total: string;
      taxes: BillLine['taxes'] | null;
    }>(
      `SELECT l.id, l.position, l.product_id, l.account_id, l.description,
              trim_scale(l.quantity)::text AS quantity, l.unit_price::text AS unit_price,
              trim_scale(l.discount_percent)::text AS discount_percent,
              l.subtotal::text AS subtotal, l.tax_total::text AS tax_total, l.total::text AS total,
              (SELECT json_agg(json_build_object(
                  'taxId', t.tax_id, 'code', t.code, 'kind', t.kind,
                  'rate', trim_scale(t.rate)::text, 'base', t.base::text, 'amount', t.amount::text))
                 FROM bill_line_taxes t WHERE t.line_id = l.id) AS taxes
         FROM bill_lines l WHERE l.bill_id = $1 ORDER BY l.position`,
      [billId],
    );
    return rows.map((r) => ({
      id: r.id,
      position: r.position,
      productId: r.product_id,
      accountId: r.account_id,
      description: r.description,
      quantity: r.quantity,
      unitPrice: r.unit_price,
      discountPercent: r.discount_percent,
      subtotal: r.subtotal,
      taxTotal: r.tax_total,
      total: r.total,
      taxes: r.taxes ?? [],
    }));
  }

  async withholdingsOf(tx: Tx, billId: string): Promise<StoredWithholding[]> {
    const { rows } = await tx.client.query<{
      tax_id: string | null;
      code: string;
      name: string;
      kind: string;
      rate: string;
      base: string;
      amount: string;
    }>(
      `SELECT tax_id, code, name, kind, trim_scale(rate)::text AS rate,
              base::text AS base, amount::text AS amount
         FROM bill_withholdings WHERE bill_id = $1 ORDER BY code`,
      [billId],
    );
    return rows.map((r) => ({
      taxId: r.tax_id,
      code: r.code,
      name: r.name,
      kind: r.kind,
      rate: r.rate,
      base: r.base,
      amount: r.amount,
    }));
  }

  async save(tx: Tx, b: Bill, createdBy: string | null): Promise<void> {
    await tx.client.query(
      `INSERT INTO bills
         (id, organization_id, number, supplier_number, party_id, order_id, receipt_id, status,
          issue_date, due_date, payment_terms_days, currency_code, exchange_rate,
          subtotal, tax_total, total, withholding_total, net_payable, paid_total, notes,
          owner_membership_id, branch_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23::uuid)`,
      [
        b.id, b.organizationId, b.number, b.supplierNumber, b.partyId, b.orderId, b.receiptId,
        b.status, b.issueDate, b.dueDate, b.paymentTermsDays, b.currencyCode, b.exchangeRate,
        b.subtotal, b.taxTotal, b.total, b.withholdingTotal, b.netPayable, b.paidTotal, b.notes,
        b.ownerMembershipId, b.branchId, createdBy,
      ],
    );
  }

  async update(tx: Tx, b: Bill): Promise<void> {
    await tx.client.query(
      `UPDATE bills SET number = $2, supplier_number = $3, party_id = $4, order_id = $5,
              receipt_id = $6, status = $7, issue_date = $8, due_date = $9,
              payment_terms_days = $10, currency_code = $11, exchange_rate = $12,
              subtotal = $13, tax_total = $14, total = $15, withholding_total = $16,
              net_payable = $17, notes = $18, owner_membership_id = $19, branch_id = $20
        WHERE id = $1`,
      [
        b.id, b.number, b.supplierNumber, b.partyId, b.orderId, b.receiptId, b.status,
        b.issueDate, b.dueDate, b.paymentTermsDays, b.currencyCode, b.exchangeRate,
        b.subtotal, b.taxTotal, b.total, b.withholdingTotal, b.netPayable, b.notes,
        b.ownerMembershipId, b.branchId,
      ],
    );
  }

  async replaceLines(
    tx: Tx,
    organizationId: string,
    billId: string,
    lines: readonly Omit<BillLine, 'id'>[],
  ): Promise<void> {
    await tx.client.query('DELETE FROM bill_lines WHERE bill_id = $1', [billId]);
    for (const line of lines) {
      const { rows } = await tx.client.query<{ id: string }>(
        `INSERT INTO bill_lines
           (id, organization_id, bill_id, position, product_id, account_id, description,
            quantity, unit_price, discount_percent, subtotal, tax_total, total)
         VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING id`,
        [
          organizationId, billId, line.position, line.productId, line.accountId, line.description,
          line.quantity, line.unitPrice, line.discountPercent, line.subtotal, line.taxTotal,
          line.total,
        ],
      );
      const lineId = rows[0]?.id;
      if (!lineId || line.taxes.length === 0) continue;
      await tx.client.query(
        `INSERT INTO bill_line_taxes (id, organization_id, line_id, tax_id, code, kind, rate, base, amount)
         SELECT gen_random_uuid(), $1, $2, tax_id, code, kind, rate, base, amount
           FROM unnest($3::uuid[], $4::text[], $5::text[], $6::numeric[], $7::numeric[], $8::numeric[])
                AS t(tax_id, code, kind, rate, base, amount)`,
        [
          organizationId,
          lineId,
          line.taxes.map((t) => t.taxId),
          line.taxes.map((t) => t.code),
          line.taxes.map((t) => t.kind),
          line.taxes.map((t) => t.rate),
          line.taxes.map((t) => t.base),
          line.taxes.map((t) => t.amount),
        ],
      );
    }
  }

  async replaceWithholdings(
    tx: Tx,
    organizationId: string,
    billId: string,
    items: readonly StoredWithholding[],
  ): Promise<void> {
    await tx.client.query('DELETE FROM bill_withholdings WHERE bill_id = $1', [billId]);
    if (items.length === 0) return;
    await tx.client.query(
      `INSERT INTO bill_withholdings
         (id, organization_id, bill_id, tax_id, code, name, kind, rate, base, amount)
       SELECT gen_random_uuid(), $1, $2, tax_id, code, name, kind, rate, base, amount
         FROM unnest($3::uuid[], $4::text[], $5::text[], $6::text[],
                     $7::numeric[], $8::numeric[], $9::numeric[])
              AS t(tax_id, code, name, kind, rate, base, amount)`,
      [
        organizationId,
        billId,
        items.map((w) => w.taxId),
        items.map((w) => w.code),
        items.map((w) => w.name),
        items.map((w) => w.kind),
        items.map((w) => w.rate),
        items.map((w) => w.base),
        items.map((w) => w.amount),
      ],
    );
  }

  async post(tx: Tx, id: string, number: string): Promise<void> {
    await tx.client.query(
      `UPDATE bills SET status = 'POSTED', number = $2, posted_at = now()
        WHERE id = $1 AND status = 'DRAFT'`,
      [id, number],
    );
  }

  async void(tx: Tx, id: string, reason: string): Promise<void> {
    await tx.client.query(
      "UPDATE bills SET status = 'VOID', voided_at = now(), void_reason = $2 WHERE id = $1",
      [id, reason],
    );
  }

  async recalculatePaid(tx: Tx, billId: string): Promise<string> {
    const { rows } = await tx.client.query<{ paid_total: string }>(
      `UPDATE bills SET paid_total = (
         SELECT coalesce(sum(a.amount), 0) FROM bill_allocations a
           JOIN payments pm ON pm.id = a.payment_id
          WHERE a.bill_id = $1 AND pm.voided_at IS NULL
       ) WHERE id = $1
       RETURNING paid_total::text AS paid_total`,
      [billId],
    );
    return rows[0]?.paid_total ?? '0';
  }

  async openForParty(tx: Tx, partyId: string): Promise<Bill[]> {
    const { rows } = await tx.client.query<BillDbRow>(
      `SELECT ${BILL_COLUMNS} FROM bills b
        WHERE b.party_id = $1 AND b.status = 'POSTED' AND b.paid_total < b.total
        ORDER BY b.due_date, b.issue_date`,
      [partyId],
    );
    return rows.map(billFrom);
  }

  async allocations(
    tx: Tx,
    paymentId: string,
  ): Promise<Array<{ billId: string; number: string | null; amount: string }>> {
    const { rows } = await tx.client.query<{ bill_id: string; number: string | null; amount: string }>(
      `SELECT a.bill_id, b.number, a.amount::text AS amount
         FROM bill_allocations a JOIN bills b ON b.id = a.bill_id
        WHERE a.payment_id = $1`,
      [paymentId],
    );
    return rows.map((r) => ({ billId: r.bill_id, number: r.number, amount: r.amount }));
  }

  async replaceAllocations(
    tx: Tx,
    organizationId: string,
    paymentId: string,
    lines: ReadonlyArray<{ billId: string; amount: string }>,
  ): Promise<void> {
    await tx.client.query('DELETE FROM bill_allocations WHERE payment_id = $1', [paymentId]);
    if (lines.length === 0) return;
    await tx.client.query(
      `INSERT INTO bill_allocations (id, organization_id, payment_id, bill_id, amount)
       SELECT gen_random_uuid(), $1, $2, bill_id, amount
         FROM unnest($3::uuid[], $4::numeric[]) AS t(bill_id, amount)`,
      [organizationId, paymentId, lines.map((l) => l.billId), lines.map((l) => l.amount)],
    );
    await tx.client.query(
      `UPDATE payments SET allocated_total = (
         SELECT coalesce(sum(amount), 0) FROM bill_allocations WHERE payment_id = $1
       ) WHERE id = $1`,
      [paymentId],
    );
  }

  /** Cuentas por pagar por edades: a quién hay que pagarle y desde cuándo. */
  async payable(tx: Tx, today: LocalDate): Promise<PayableRow[]> {
    const { rows } = await tx.client.query<PayableRow & Record<string, string>>(
      `SELECT b.party_id AS "partyId", pa.display_name AS "partyName",
              SUM(b.total - b.paid_total) FILTER (WHERE b.due_date >= $1::date)::text AS current,
              SUM(b.total - b.paid_total)
                FILTER (WHERE b.due_date < $1::date AND b.due_date >= $1::date - 30)::text AS d1_30,
              SUM(b.total - b.paid_total)
                FILTER (WHERE b.due_date < $1::date - 30 AND b.due_date >= $1::date - 60)::text AS d31_60,
              SUM(b.total - b.paid_total)
                FILTER (WHERE b.due_date < $1::date - 60 AND b.due_date >= $1::date - 90)::text AS d61_90,
              SUM(b.total - b.paid_total)
                FILTER (WHERE b.due_date < $1::date - 90)::text AS d90_plus,
              SUM(b.total - b.paid_total)::text AS total
         FROM bills b JOIN parties pa ON pa.id = b.party_id
        WHERE b.status = 'POSTED' AND b.paid_total < b.total
        GROUP BY b.party_id, pa.display_name
        ORDER BY SUM(b.total - b.paid_total) DESC`,
      [today],
    );
    // Los tramos sin facturas llegan como NULL y se presentan como cero: una
    // tabla de cartera con huecos se lee peor que una llena de ceros.
    return rows.map((r) => ({
      partyId: r.partyId,
      partyName: r.partyName,
      current: r.current ?? '0',
      d1_30: r.d1_30 ?? '0',
      d31_60: r.d31_60 ?? '0',
      d61_90: r.d61_90 ?? '0',
      d90_plus: r.d90_plus ?? '0',
      total: r.total ?? '0',
    }));
  }
}

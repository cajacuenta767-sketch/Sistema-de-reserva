-- ═══════════════════════════════════════════════════════════════════════════
-- 0010 · Compras: órdenes, recepciones y facturas de proveedor
-- ═══════════════════════════════════════════════════════════════════════════
--
-- El ciclo de compra son TRES documentos distintos que la gente confunde
-- constantemente, y separarlos es justo lo que permite detectar los problemas:
--
--   · La ORDEN dice lo que se pidió.
--   · La RECEPCIÓN dice lo que llegó.
--   · La FACTURA dice lo que cobran.
--
-- Cuando los tres coinciden no hay nada que revisar. Cuando no —llegaron 8 de
-- las 10 pedidas y facturan 10—, el sistema lo ve porque son documentos
-- separados. Con un solo documento "compra", esa diferencia no existe y se paga
-- de más sin que nadie se entere.

-- ── Órdenes de compra ────────────────────────────────────────────────────────

CREATE TABLE purchase_orders (
  id              uuid PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  number          text,
  party_id        uuid        NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,
  warehouse_id    uuid        REFERENCES warehouses(id) ON DELETE SET NULL,
  status          text        NOT NULL DEFAULT 'DRAFT'
                    CHECK (status IN ('DRAFT','SENT','PARTIAL','RECEIVED','CANCELLED')),
  order_date      date        NOT NULL,
  expected_date   date,
  currency_code   char(3)     NOT NULL DEFAULT 'COP' REFERENCES currencies(code),
  exchange_rate   numeric(19,6) NOT NULL DEFAULT 1 CHECK (exchange_rate > 0),

  subtotal        numeric(19,4) NOT NULL DEFAULT 0,
  tax_total       numeric(19,4) NOT NULL DEFAULT 0,
  total           numeric(19,4) NOT NULL DEFAULT 0,

  notes           text,
  terms           text,
  owner_membership_id uuid    REFERENCES memberships(id) ON DELETE SET NULL,
  branch_id       uuid        REFERENCES branches(id) ON DELETE SET NULL,
  created_by      uuid        REFERENCES memberships(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  CONSTRAINT purchase_orders_expected_after_order
    CHECK (expected_date IS NULL OR expected_date >= order_date)
);
CREATE UNIQUE INDEX purchase_orders_number ON purchase_orders (organization_id, number)
  WHERE number IS NOT NULL;
CREATE INDEX purchase_orders_party ON purchase_orders (organization_id, party_id)
  WHERE deleted_at IS NULL;
-- El índice de "qué está pendiente de llegar", que es la pantalla que se mira.
CREATE INDEX purchase_orders_pending ON purchase_orders (organization_id, expected_date)
  WHERE status IN ('SENT','PARTIAL') AND deleted_at IS NULL;
SELECT enable_tenant_rls('purchase_orders');
SELECT attach_updated_at('purchase_orders');

CREATE TABLE purchase_order_lines (
  id              uuid PRIMARY KEY,
  organization_id uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_id        uuid          NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  position        smallint      NOT NULL,
  product_id      uuid          REFERENCES products(id) ON DELETE RESTRICT,
  description     text          NOT NULL,
  sku             text,
  uom_code        text,
  quantity        numeric(19,6) NOT NULL CHECK (quantity > 0),
  -- Lo que ya llegó de esta línea. Se recalcula desde las recepciones, igual
  -- que lo pagado de una factura se recalcula desde las imputaciones: un
  -- contador que se incrementa se descuadra en cuanto una recepción se anula.
  received        numeric(19,6) NOT NULL DEFAULT 0 CHECK (received >= 0),
  unit_price      numeric(19,4) NOT NULL CHECK (unit_price >= 0),
  discount_percent numeric(9,6) NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 100),
  tax_id          uuid          REFERENCES taxes(id) ON DELETE SET NULL,
  subtotal        numeric(19,4) NOT NULL DEFAULT 0,
  tax_total       numeric(19,4) NOT NULL DEFAULT 0,
  total           numeric(19,4) NOT NULL DEFAULT 0,
  UNIQUE (order_id, position)
);
CREATE INDEX purchase_order_lines_order ON purchase_order_lines (order_id, position);
CREATE INDEX purchase_order_lines_product ON purchase_order_lines (organization_id, product_id);
SELECT enable_tenant_rls('purchase_order_lines');

-- ── Recepciones ──────────────────────────────────────────────────────────────
--
-- Lo que de verdad llegó. Es el documento que mueve el inventario: ni la orden
-- ni la factura lo hacen. Una orden es una intención y una factura es un cobro;
-- solo la recepción es un hecho físico.

CREATE TABLE goods_receipts (
  id              uuid PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  number          text,
  party_id        uuid        NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,
  order_id        uuid        REFERENCES purchase_orders(id) ON DELETE SET NULL,
  warehouse_id    uuid        NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  status          text        NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','POSTED','VOID')),
  receipt_date    date        NOT NULL,
  -- Guía o remisión del proveedor: lo que permite reclamar cuando falta algo.
  reference       text,
  notes           text,
  posted_at       timestamptz,
  voided_at       timestamptz,
  void_reason     text,
  created_by      uuid        REFERENCES memberships(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT goods_receipts_posted_has_number
    CHECK (status = 'DRAFT' OR (number IS NOT NULL AND posted_at IS NOT NULL)),
  CONSTRAINT goods_receipts_void_has_reason
    CHECK (status <> 'VOID' OR (voided_at IS NOT NULL AND void_reason IS NOT NULL))
);
CREATE UNIQUE INDEX goods_receipts_number ON goods_receipts (organization_id, number)
  WHERE number IS NOT NULL;
CREATE INDEX goods_receipts_order ON goods_receipts (organization_id, order_id);
SELECT enable_tenant_rls('goods_receipts');
SELECT attach_updated_at('goods_receipts');

CREATE TABLE goods_receipt_lines (
  id              uuid PRIMARY KEY,
  organization_id uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  receipt_id      uuid          NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
  order_line_id   uuid          REFERENCES purchase_order_lines(id) ON DELETE SET NULL,
  position        smallint      NOT NULL,
  product_id      uuid          NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  lot_id          uuid          REFERENCES stock_lots(id) ON DELETE RESTRICT,
  description     text          NOT NULL,
  quantity        numeric(19,6) NOT NULL CHECK (quantity > 0),
  -- Costo con el que entra al inventario. Puede no ser el de la orden: los
  -- fletes y la nacionalización suben el costo real de la mercancía y no
  -- aparecen en el precio pactado.
  unit_cost       numeric(19,4) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  UNIQUE (receipt_id, position)
);
CREATE INDEX goods_receipt_lines_receipt ON goods_receipt_lines (receipt_id, position);
CREATE INDEX goods_receipt_lines_order_line ON goods_receipt_lines (order_line_id)
  WHERE order_line_id IS NOT NULL;
SELECT enable_tenant_rls('goods_receipt_lines');

-- ── Facturas de proveedor ────────────────────────────────────────────────────

CREATE TABLE bills (
  id              uuid PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- Consecutivo INTERNO, para referirse a ella.
  number          text,
  -- El número que trae la factura del proveedor. Es el que la DIAN cruza, y
  -- por eso no puede repetirse para el mismo proveedor: pagar dos veces la
  -- misma factura es el error de cuentas por pagar más caro y más común.
  supplier_number text        NOT NULL,
  party_id        uuid        NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,
  order_id        uuid        REFERENCES purchase_orders(id) ON DELETE SET NULL,
  receipt_id      uuid        REFERENCES goods_receipts(id) ON DELETE SET NULL,
  status          text        NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','POSTED','VOID')),
  issue_date      date        NOT NULL,
  due_date        date        NOT NULL,
  payment_terms_days smallint NOT NULL DEFAULT 0,
  currency_code   char(3)     NOT NULL DEFAULT 'COP' REFERENCES currencies(code),
  exchange_rate   numeric(19,6) NOT NULL DEFAULT 1 CHECK (exchange_rate > 0),

  subtotal        numeric(19,4) NOT NULL DEFAULT 0,
  tax_total       numeric(19,4) NOT NULL DEFAULT 0,
  total           numeric(19,4) NOT NULL DEFAULT 0,
  -- Retenciones que PRACTICAMOS al proveedor: reducen lo que se le transfiere
  -- y se convierten en un pasivo con la DIAN.
  withholding_total numeric(19,4) NOT NULL DEFAULT 0,
  net_payable     numeric(19,4) NOT NULL DEFAULT 0,
  paid_total      numeric(19,4) NOT NULL DEFAULT 0 CHECK (paid_total >= 0),

  notes           text,
  posted_at       timestamptz,
  voided_at       timestamptz,
  void_reason     text,
  owner_membership_id uuid    REFERENCES memberships(id) ON DELETE SET NULL,
  branch_id       uuid        REFERENCES branches(id) ON DELETE SET NULL,
  created_by      uuid        REFERENCES memberships(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bills_due_after_issue CHECK (due_date >= issue_date),
  CONSTRAINT bills_posted_has_number
    CHECK (status = 'DRAFT' OR (number IS NOT NULL AND posted_at IS NOT NULL))
);
-- Un proveedor no factura dos veces con el mismo número. Es lo que impide
-- registrar —y pagar— la misma factura dos veces.
CREATE UNIQUE INDEX bills_supplier_number
  ON bills (organization_id, party_id, supplier_number)
  WHERE status <> 'VOID';
CREATE UNIQUE INDEX bills_number ON bills (organization_id, number) WHERE number IS NOT NULL;
CREATE INDEX bills_party ON bills (organization_id, party_id, due_date);
-- Cuentas por pagar: facturas contabilizadas con saldo, por vencimiento.
CREATE INDEX bills_outstanding ON bills (organization_id, due_date)
  WHERE status = 'POSTED' AND paid_total < total;
SELECT enable_tenant_rls('bills');
SELECT attach_updated_at('bills');

CREATE TABLE bill_lines (
  id              uuid PRIMARY KEY,
  organization_id uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  bill_id         uuid          NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  position        smallint      NOT NULL,
  product_id      uuid          REFERENCES products(id) ON DELETE RESTRICT,
  -- Cuenta de gasto o de costo cuando la línea no es mercancía: servicios,
  -- arrendamientos, honorarios. Sin esto, todo gasto acabaría en una sola
  -- cuenta y el estado de resultados no diría nada.
  account_id      uuid          REFERENCES accounts(id) ON DELETE RESTRICT,
  description     text          NOT NULL,
  quantity        numeric(19,6) NOT NULL CHECK (quantity > 0),
  unit_price      numeric(19,4) NOT NULL CHECK (unit_price >= 0),
  discount_percent numeric(9,6) NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 100),
  subtotal        numeric(19,4) NOT NULL DEFAULT 0,
  tax_total       numeric(19,4) NOT NULL DEFAULT 0,
  total           numeric(19,4) NOT NULL DEFAULT 0,
  UNIQUE (bill_id, position)
);
CREATE INDEX bill_lines_bill ON bill_lines (bill_id, position);
SELECT enable_tenant_rls('bill_lines');

CREATE TABLE bill_line_taxes (
  id              uuid PRIMARY KEY,
  organization_id uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  line_id         uuid          NOT NULL REFERENCES bill_lines(id) ON DELETE CASCADE,
  tax_id          uuid          REFERENCES taxes(id) ON DELETE SET NULL,
  code            text          NOT NULL,
  kind            text          NOT NULL,
  rate            numeric(9,6)  NOT NULL,
  base            numeric(19,4) NOT NULL,
  amount          numeric(19,4) NOT NULL,
  UNIQUE (line_id, code)
);
CREATE INDEX bill_line_taxes_line ON bill_line_taxes (line_id);
SELECT enable_tenant_rls('bill_line_taxes');

CREATE TABLE bill_withholdings (
  id              uuid PRIMARY KEY,
  organization_id uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  bill_id         uuid          NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  tax_id          uuid          REFERENCES taxes(id) ON DELETE SET NULL,
  code            text          NOT NULL,
  name            text          NOT NULL,
  kind            text          NOT NULL,
  rate            numeric(9,6)  NOT NULL,
  base            numeric(19,4) NOT NULL,
  amount          numeric(19,4) NOT NULL,
  UNIQUE (bill_id, code)
);
SELECT enable_tenant_rls('bill_withholdings');

-- ── Pagos a proveedores ──────────────────────────────────────────────────────
--
-- Reutilizan `payments` con `direction = 'OUT'`: es el mismo hecho —dinero que
-- se mueve contra un tercero— y duplicar la tabla obligaría a mantener dos
-- veces la conciliación bancaria y el arqueo de caja.

CREATE TABLE bill_allocations (
  id              uuid PRIMARY KEY,
  organization_id uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  payment_id      uuid          NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  bill_id         uuid          NOT NULL REFERENCES bills(id) ON DELETE RESTRICT,
  amount          numeric(19,4) NOT NULL CHECK (amount > 0),
  created_at      timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (payment_id, bill_id)
);
CREATE INDEX bill_allocations_bill ON bill_allocations (organization_id, bill_id);
SELECT enable_tenant_rls('bill_allocations');

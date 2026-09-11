-- ═══════════════════════════════════════════════════════════════════════════
-- 0007 · Ventas: cotizaciones, facturas, notas de crédito y pagos
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Dos decisiones gobiernan todo este esquema:
--
-- 1. **Una factura emitida es inmutable.** No se edita ni se borra: se anula o
--    se corrige con una nota de crédito. Por eso no hay borrado lógico en
--    `invoices` —solo `voided_at`— y por eso el consecutivo no puede tener
--    huecos: la DIAN lo exige y el contador lo necesita para cuadrar el mes.
--
-- 2. **Las líneas guardan su propio impuesto y su propio precio.** No apuntan
--    al catálogo para calcularlo: lo COPIAN al emitir. Si la factura leyera la
--    tarifa de IVA vigente, subir el IVA del 19 al 21 % en 2028 cambiaría el
--    total de todas las facturas de 2026, y la contabilidad de años ya
--    declarados dejaría de cuadrar de un día para otro.

-- ── Cotizaciones ─────────────────────────────────────────────────────────────

CREATE TABLE quotes (
  id                uuid PRIMARY KEY,
  organization_id   uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  number            text        NOT NULL,
  party_id          uuid        NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,
  contact_id        uuid        REFERENCES contacts(id) ON DELETE SET NULL,
  status            text        NOT NULL DEFAULT 'DRAFT'
                      CHECK (status IN ('DRAFT','SENT','ACCEPTED','REJECTED','EXPIRED','CONVERTED')),
  issue_date        date        NOT NULL,
  -- Hasta cuándo se respeta el precio. Sin fecha, una cotización de hace un año
  -- sigue pareciendo válida y alguien la acepta.
  valid_until       date,
  currency_code     char(3)     NOT NULL DEFAULT 'COP' REFERENCES currencies(code),
  price_list_id     uuid        REFERENCES price_lists(id) ON DELETE SET NULL,
  global_discount_percent numeric(9,6) NOT NULL DEFAULT 0
                      CHECK (global_discount_percent BETWEEN 0 AND 100),
  subtotal          numeric(19,4) NOT NULL DEFAULT 0,
  discount_total    numeric(19,4) NOT NULL DEFAULT 0,
  tax_total         numeric(19,4) NOT NULL DEFAULT 0,
  total             numeric(19,4) NOT NULL DEFAULT 0,
  notes             text,
  terms             text,
  -- Documento que nació de esta cotización, para no convertirla dos veces.
  converted_invoice_id uuid,
  owner_membership_id  uuid     REFERENCES memberships(id) ON DELETE SET NULL,
  branch_id         uuid        REFERENCES branches(id) ON DELETE SET NULL,
  created_by        uuid        REFERENCES memberships(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  UNIQUE (organization_id, number)
);
CREATE INDEX quotes_party ON quotes (organization_id, party_id) WHERE deleted_at IS NULL;
CREATE INDEX quotes_status ON quotes (organization_id, status) WHERE deleted_at IS NULL;
SELECT enable_tenant_rls('quotes');
SELECT attach_updated_at('quotes');

-- ── Facturas ─────────────────────────────────────────────────────────────────

CREATE TABLE invoices (
  id                uuid PRIMARY KEY,
  organization_id   uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- Vacío mientras es borrador: el consecutivo se asigna AL EMITIR, no al
  -- crear. Asignarlo antes deja huecos en cuanto alguien descarta un borrador,
  -- y un hueco en la numeración fiscal hay que justificarlo ante la DIAN.
  number            text,
  party_id          uuid        NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,
  quote_id          uuid        REFERENCES quotes(id) ON DELETE SET NULL,
  status            text        NOT NULL DEFAULT 'DRAFT'
                      CHECK (status IN ('DRAFT','ISSUED','VOID')),
  issue_date        date        NOT NULL,
  due_date          date        NOT NULL,
  payment_terms_days smallint   NOT NULL DEFAULT 0,
  currency_code     char(3)     NOT NULL DEFAULT 'COP' REFERENCES currencies(code),
  -- Tasa del día de emisión, congelada. Volver a convertir con la tasa de hoy
  -- cambiaría el importe en pesos de una factura ya declarada.
  exchange_rate     numeric(19,6) NOT NULL DEFAULT 1 CHECK (exchange_rate > 0),
  price_list_id     uuid        REFERENCES price_lists(id) ON DELETE SET NULL,
  global_discount_percent numeric(9,6) NOT NULL DEFAULT 0
                      CHECK (global_discount_percent BETWEEN 0 AND 100),

  subtotal          numeric(19,4) NOT NULL DEFAULT 0,
  discount_total    numeric(19,4) NOT NULL DEFAULT 0,
  tax_total         numeric(19,4) NOT NULL DEFAULT 0,
  -- Lo que dice la factura. Las retenciones NO se restan de aquí.
  total             numeric(19,4) NOT NULL DEFAULT 0,
  withholding_total numeric(19,4) NOT NULL DEFAULT 0,
  -- total − retenciones: lo que el cliente transfiere.
  net_payable       numeric(19,4) NOT NULL DEFAULT 0,
  -- Suma de las imputaciones de pago. Se mantiene al imputar y al anular un
  -- pago, y el estado se deriva de ella: guardar el estado como un campo suelto
  -- lo desincroniza en cuanto un pago se anula por otra vía.
  paid_total        numeric(19,4) NOT NULL DEFAULT 0 CHECK (paid_total >= 0),

  notes             text,
  terms             text,
  -- Resolución DIAN bajo la que se emitió, congelada en el documento.
  dian_resolution   text,
  issued_at         timestamptz,
  voided_at         timestamptz,
  void_reason       text,
  owner_membership_id uuid      REFERENCES memberships(id) ON DELETE SET NULL,
  branch_id         uuid        REFERENCES branches(id) ON DELETE SET NULL,
  created_by        uuid        REFERENCES memberships(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  -- Una factura emitida SIEMPRE tiene número y fecha de emisión. Sin esto, un
  -- fallo a medio emitir dejaría un documento "emitido" sin consecutivo, que no
  -- se puede ni reportar ni corregir.
  CONSTRAINT invoices_issued_has_number
    CHECK (status = 'DRAFT' OR (number IS NOT NULL AND issued_at IS NOT NULL)),
  CONSTRAINT invoices_void_has_reason
    CHECK (status <> 'VOID' OR (voided_at IS NOT NULL AND void_reason IS NOT NULL)),
  CONSTRAINT invoices_due_after_issue CHECK (due_date >= issue_date)
);
-- El consecutivo es único entre las facturas que existen. Parcial porque los
-- borradores no tienen número todavía.
CREATE UNIQUE INDEX invoices_number ON invoices (organization_id, number) WHERE number IS NOT NULL;
CREATE INDEX invoices_party ON invoices (organization_id, party_id);
CREATE INDEX invoices_status ON invoices (organization_id, status, due_date);
-- Índice de la cartera: facturas emitidas con saldo, ordenadas por vencimiento.
CREATE INDEX invoices_outstanding ON invoices (organization_id, due_date)
  WHERE status = 'ISSUED' AND paid_total < total;
SELECT enable_tenant_rls('invoices');
SELECT attach_updated_at('invoices');

-- ── Líneas ───────────────────────────────────────────────────────────────────
--
-- Una sola tabla para los dos documentos, con el padre en columnas excluyentes.
-- Tablas separadas obligarían a duplicar el cálculo de totales y a mantener dos
-- esquemas que tienen que decir exactamente lo mismo.

CREATE TABLE document_lines (
  id                uuid PRIMARY KEY,
  organization_id   uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  quote_id          uuid        REFERENCES quotes(id) ON DELETE CASCADE,
  invoice_id        uuid        REFERENCES invoices(id) ON DELETE CASCADE,
  credit_note_id    uuid,
  position          smallint    NOT NULL,

  product_id        uuid        REFERENCES products(id) ON DELETE RESTRICT,
  variant_id        uuid        REFERENCES product_variants(id) ON DELETE RESTRICT,
  -- Copiada del producto al crear la línea: si el producto se renombra, la
  -- factura del año pasado tiene que seguir diciendo lo que decía.
  description       text        NOT NULL,
  sku               text,
  uom_code          text,

  quantity          numeric(19,6) NOT NULL CHECK (quantity > 0),
  unit_price        numeric(19,4) NOT NULL CHECK (unit_price >= 0),
  discount_percent  numeric(9,6)  NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 100),

  gross             numeric(19,4) NOT NULL DEFAULT 0,
  discount_amount   numeric(19,4) NOT NULL DEFAULT 0,
  subtotal          numeric(19,4) NOT NULL DEFAULT 0,
  tax_total         numeric(19,4) NOT NULL DEFAULT 0,
  total             numeric(19,4) NOT NULL DEFAULT 0,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  -- Exactamente un padre. Sin esto, una línea huérfana o con dos padres se
  -- contaría dos veces en los totales de venta.
  CONSTRAINT document_lines_one_parent CHECK (
    (quote_id IS NOT NULL)::int + (invoice_id IS NOT NULL)::int + (credit_note_id IS NOT NULL)::int = 1
  )
);
CREATE INDEX document_lines_quote ON document_lines (quote_id, position) WHERE quote_id IS NOT NULL;
CREATE INDEX document_lines_invoice ON document_lines (invoice_id, position) WHERE invoice_id IS NOT NULL;
CREATE INDEX document_lines_credit_note ON document_lines (credit_note_id, position) WHERE credit_note_id IS NOT NULL;
CREATE INDEX document_lines_product ON document_lines (organization_id, product_id);
SELECT enable_tenant_rls('document_lines');
SELECT attach_updated_at('document_lines');

-- Impuestos de cada línea, con la tarifa CONGELADA.
CREATE TABLE document_line_taxes (
  id                uuid PRIMARY KEY,
  organization_id   uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  line_id           uuid          NOT NULL REFERENCES document_lines(id) ON DELETE CASCADE,
  tax_id            uuid          REFERENCES taxes(id) ON DELETE SET NULL,
  code              text          NOT NULL,
  kind              text          NOT NULL,
  -- La tarifa que regía el día de la emisión, no la vigente hoy.
  rate              numeric(9,6)  NOT NULL,
  base              numeric(19,4) NOT NULL,
  amount            numeric(19,4) NOT NULL,
  UNIQUE (line_id, code)
);
CREATE INDEX document_line_taxes_line ON document_line_taxes (line_id);
SELECT enable_tenant_rls('document_line_taxes');

-- Retenciones del documento. Van a nivel de cabecera porque la base mínima se
-- compara contra el total, no contra cada línea.
CREATE TABLE document_withholdings (
  id                uuid PRIMARY KEY,
  organization_id   uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_id        uuid          NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  tax_id            uuid          REFERENCES taxes(id) ON DELETE SET NULL,
  code              text          NOT NULL,
  name              text          NOT NULL,
  kind              text          NOT NULL,
  rate              numeric(9,6)  NOT NULL,
  base              numeric(19,4) NOT NULL,
  amount            numeric(19,4) NOT NULL,
  UNIQUE (invoice_id, code)
);
SELECT enable_tenant_rls('document_withholdings');

-- ── Notas de crédito ─────────────────────────────────────────────────────────
--
-- La única forma de corregir una factura emitida. Apunta a la factura que
-- corrige, así que la trazabilidad factura → corrección es consultable.

CREATE TABLE credit_notes (
  id                uuid PRIMARY KEY,
  organization_id   uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  number            text,
  invoice_id        uuid        NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  party_id          uuid        NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,
  status            text        NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ISSUED','VOID')),
  issue_date        date        NOT NULL,
  currency_code     char(3)     NOT NULL DEFAULT 'COP' REFERENCES currencies(code),
  -- Motivo según los códigos de la DIAN para notas crédito.
  reason_code       text        NOT NULL DEFAULT '2'
                      CHECK (reason_code IN ('1','2','3','4','5','6')),
  reason            text        NOT NULL,
  subtotal          numeric(19,4) NOT NULL DEFAULT 0,
  tax_total         numeric(19,4) NOT NULL DEFAULT 0,
  total             numeric(19,4) NOT NULL DEFAULT 0,
  issued_at         timestamptz,
  created_by        uuid        REFERENCES memberships(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT credit_notes_issued_has_number
    CHECK (status = 'DRAFT' OR (number IS NOT NULL AND issued_at IS NOT NULL))
);
CREATE UNIQUE INDEX credit_notes_number ON credit_notes (organization_id, number) WHERE number IS NOT NULL;
CREATE INDEX credit_notes_invoice ON credit_notes (organization_id, invoice_id);
SELECT enable_tenant_rls('credit_notes');
SELECT attach_updated_at('credit_notes');

ALTER TABLE document_lines
  ADD CONSTRAINT document_lines_credit_note_fk
  FOREIGN KEY (credit_note_id) REFERENCES credit_notes(id) ON DELETE CASCADE;

-- ── Pagos ────────────────────────────────────────────────────────────────────

CREATE TABLE payments (
  id                uuid PRIMARY KEY,
  organization_id   uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  number            text,
  party_id          uuid        NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,
  -- IN: cobro a un cliente. OUT: pago a un proveedor (lo usará compras).
  direction         text        NOT NULL DEFAULT 'IN' CHECK (direction IN ('IN','OUT')),
  payment_date      date        NOT NULL,
  method            text        NOT NULL DEFAULT 'TRANSFER'
                      CHECK (method IN ('CASH','TRANSFER','CARD','CHECK','OTHER')),
  currency_code     char(3)     NOT NULL DEFAULT 'COP' REFERENCES currencies(code),
  amount            numeric(19,4) NOT NULL CHECK (amount > 0),
  -- Lo imputado a facturas. La diferencia con `amount` es saldo a favor del
  -- cliente, y se deja explícito en vez de forzarlo sobre la última factura:
  -- una factura pagada de más es un estado que la contabilidad no representa.
  allocated_total   numeric(19,4) NOT NULL DEFAULT 0 CHECK (allocated_total >= 0),
  reference         text,
  notes             text,
  voided_at         timestamptz,
  void_reason       text,
  created_by        uuid        REFERENCES memberships(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payments_not_over_allocated CHECK (allocated_total <= amount)
);
CREATE UNIQUE INDEX payments_number ON payments (organization_id, number) WHERE number IS NOT NULL;
CREATE INDEX payments_party ON payments (organization_id, party_id, payment_date);
SELECT enable_tenant_rls('payments');
SELECT attach_updated_at('payments');

-- Qué parte de qué pago salda qué factura. Es la tabla que responde "¿por qué
-- esta factura figura como pagada?" y "¿a dónde fue este dinero?".
CREATE TABLE payment_allocations (
  id                uuid PRIMARY KEY,
  organization_id   uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  payment_id        uuid          NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  invoice_id        uuid          NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  amount            numeric(19,4) NOT NULL CHECK (amount > 0),
  created_at        timestamptz   NOT NULL DEFAULT now(),
  -- Un pago imputa UNA vez a cada factura: dos filas para el mismo par serían
  -- dos formas de contar lo mismo.
  UNIQUE (payment_id, invoice_id)
);
CREATE INDEX payment_allocations_invoice ON payment_allocations (organization_id, invoice_id);
SELECT enable_tenant_rls('payment_allocations');

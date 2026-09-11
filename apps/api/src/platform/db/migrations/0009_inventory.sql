-- ═══════════════════════════════════════════════════════════════════════════
-- 0009 · Inventario: bodegas, movimientos y costo
-- ═══════════════════════════════════════════════════════════════════════════
--
-- La decisión que gobierna todo este esquema: **el saldo de existencias NO se
-- guarda como un número que se suma y se resta**. Se deriva de una tabla de
-- movimientos que solo crece.
--
-- Un contador que se incrementa es cómodo hasta el primer fallo a medias: basta
-- una recepción que se revirtió después de tocarlo para que el sistema diga 40
-- unidades donde hay 37, y a partir de ahí nadie puede decir cuándo empezó la
-- diferencia ni qué documento la causó. Con movimientos, el saldo siempre se
-- puede reconstruir, y la pregunta "¿por qué hay 37?" tiene respuesta: estos
-- veintitrés movimientos.
--
-- `stock_levels` existe igualmente, pero como CACHÉ: se recalcula desde los
-- movimientos y hay un test que comprueba que ambos coinciden. Sin caché, la
-- pantalla de productos haría una agregación sobre millones de filas por cada
-- listado.

-- ── Bodegas ──────────────────────────────────────────────────────────────────

CREATE TABLE warehouses (
  id              uuid PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code            text        NOT NULL,
  name            text        NOT NULL,
  branch_id       uuid        REFERENCES branches(id) ON DELETE SET NULL,
  address         text,
  city            text,
  -- La bodega a la que van las compras y de la que salen las ventas mientras
  -- nadie elija otra. Sin una por defecto, cada documento obligaría a escoger.
  is_default      boolean     NOT NULL DEFAULT false,
  is_active       boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  UNIQUE (organization_id, code)
);
CREATE UNIQUE INDEX warehouses_one_default ON warehouses (organization_id)
  WHERE is_default AND deleted_at IS NULL;
SELECT enable_tenant_rls('warehouses');
SELECT attach_updated_at('warehouses');

-- ── Lotes y series ───────────────────────────────────────────────────────────

CREATE TABLE stock_lots (
  id              uuid PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id      uuid        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  code            text        NOT NULL,
  -- Fecha de vencimiento: lo que hace que un lote de alimentos o medicinas
  -- pueda sacarse antes que otro más nuevo.
  expires_on      date,
  manufactured_on date,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, product_id, code)
);
CREATE INDEX stock_lots_expiry ON stock_lots (organization_id, expires_on)
  WHERE expires_on IS NOT NULL;
SELECT enable_tenant_rls('stock_lots');

-- ── Movimientos ──────────────────────────────────────────────────────────────
--
-- La tabla que manda. Solo se inserta: no se actualiza ni se borra, igual que
-- un asiento contabilizado, y por la misma razón —el inventario también se
-- declara, y una corrección tiene que quedar como movimiento propio—.

CREATE TABLE stock_moves (
  id              uuid PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id      uuid        NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  variant_id      uuid        REFERENCES product_variants(id) ON DELETE RESTRICT,
  warehouse_id    uuid        NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  lot_id          uuid        REFERENCES stock_lots(id) ON DELETE RESTRICT,

  kind            text        NOT NULL CHECK (kind IN (
                      'RECEIPT','ISSUE','ADJUSTMENT','TRANSFER_IN','TRANSFER_OUT',
                      'RETURN_IN','RETURN_OUT','OPENING','COUNT')),
  moved_at        timestamptz NOT NULL DEFAULT now(),
  move_date       date        NOT NULL,

  -- Cantidad CON SIGNO: positiva entra, negativa sale. Guardar la cantidad en
  -- positivo y el sentido aparte obliga a recordar el signo en cada suma, y
  -- basta olvidarlo una vez para que el saldo salga al revés.
  quantity        numeric(19,6) NOT NULL CHECK (quantity <> 0),
  -- Costo unitario del movimiento. En las salidas es el costo promedio vigente
  -- en ese instante, congelado: recalcularlo después cambiaría el costo de
  -- ventas de meses ya cerrados.
  unit_cost       numeric(19,4) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  total_cost      numeric(19,4) NOT NULL DEFAULT 0,

  -- Saldo y costo promedio DESPUÉS de este movimiento. Redundante a propósito:
  -- es lo que convierte el kardex en un documento legible sin recalcular la
  -- historia entera en cada consulta, y lo que permite auditar en qué
  -- movimiento exacto se torció un costo.
  balance_after   numeric(19,6) NOT NULL,
  average_after   numeric(19,4) NOT NULL DEFAULT 0 CHECK (average_after >= 0),

  source_type     text        NOT NULL DEFAULT 'MANUAL',
  source_id       uuid,
  notes           text,
  created_by      uuid        REFERENCES memberships(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),

  -- Las entradas suman y las salidas restan: el tipo y el signo tienen que
  -- decir lo mismo. `ADJUSTMENT` y `COUNT` van en los dos sentidos.
  CONSTRAINT stock_moves_sign_matches_kind CHECK (
    CASE
      WHEN kind IN ('RECEIPT','TRANSFER_IN','RETURN_IN','OPENING') THEN quantity > 0
      WHEN kind IN ('ISSUE','TRANSFER_OUT','RETURN_OUT') THEN quantity < 0
      ELSE true
    END
  )
);
-- El índice del kardex: los movimientos de un producto en una bodega, en orden.
CREATE INDEX stock_moves_kardex
  ON stock_moves (organization_id, product_id, warehouse_id, moved_at, id);
CREATE INDEX stock_moves_source ON stock_moves (organization_id, source_type, source_id)
  WHERE source_id IS NOT NULL;
CREATE INDEX stock_moves_lot ON stock_moves (organization_id, lot_id) WHERE lot_id IS NOT NULL;
SELECT enable_tenant_rls('stock_moves');

/*
 * Un movimiento no se toca. Corregirlo es otro movimiento.
 *
 * Con un disparador que LANZA, no con una regla `DO INSTEAD NOTHING`. La regla
 * haría que el UPDATE "funcionara" afectando a cero filas: quien la escribiera
 * por error vería una operación exitosa y un saldo que no cambia, y buscaría el
 * fallo en cualquier otro sitio. Una restricción que no falla cuando debe da
 * falsa confianza, que es peor que no tenerla.
 */
CREATE OR REPLACE FUNCTION assert_stock_move_immutable() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'Un movimiento de inventario no se %: corrígelo con un movimiento de ajuste',
    CASE TG_OP WHEN 'DELETE' THEN 'borra' ELSE 'modifica' END
    USING ERRCODE = 'check_violation';
END $$;

CREATE TRIGGER stock_moves_immutable
  BEFORE UPDATE OR DELETE ON stock_moves
  FOR EACH ROW EXECUTE FUNCTION assert_stock_move_immutable();

-- ── Existencias (caché) ──────────────────────────────────────────────────────
--
-- Se recalcula desde `stock_moves`. Existe para que listar productos no tenga
-- que agregar millones de filas, no como fuente de verdad. Un test comprueba
-- que coincide con la suma de los movimientos.

CREATE TABLE stock_levels (
  organization_id uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id      uuid          NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  warehouse_id    uuid          NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  quantity        numeric(19,6) NOT NULL DEFAULT 0,
  -- Comprometido por pedidos pendientes de despachar. Disponible = quantity −
  -- reserved: sin esto, dos vendedores comprometen la misma unidad.
  reserved        numeric(19,6) NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  average_cost    numeric(19,4) NOT NULL DEFAULT 0 CHECK (average_cost >= 0),
  updated_at      timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, warehouse_id)
);
CREATE INDEX stock_levels_org ON stock_levels (organization_id, product_id);
SELECT enable_tenant_rls('stock_levels');

-- ── Conteos físicos ──────────────────────────────────────────────────────────

CREATE TABLE stock_counts (
  id              uuid PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  number          text,
  warehouse_id    uuid        NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  status          text        NOT NULL DEFAULT 'DRAFT'
                    CHECK (status IN ('DRAFT','COUNTING','APPLIED','CANCELLED')),
  count_date      date        NOT NULL,
  notes           text,
  applied_at      timestamptz,
  applied_by      uuid        REFERENCES memberships(id) ON DELETE SET NULL,
  created_by      uuid        REFERENCES memberships(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX stock_counts_number ON stock_counts (organization_id, number)
  WHERE number IS NOT NULL;
SELECT enable_tenant_rls('stock_counts');
SELECT attach_updated_at('stock_counts');

CREATE TABLE stock_count_lines (
  id              uuid PRIMARY KEY,
  organization_id uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  count_id        uuid          NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE,
  product_id      uuid          NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  lot_id          uuid          REFERENCES stock_lots(id) ON DELETE RESTRICT,
  -- Lo que decía el sistema al empezar el conteo, congelado: si se leyera al
  -- aplicar, una venta hecha mientras se contaba cambiaría la diferencia y el
  -- ajuste taparía el movimiento en vez de reflejar lo contado.
  expected        numeric(19,6) NOT NULL,
  counted         numeric(19,6),
  notes           text,
  UNIQUE (count_id, product_id, lot_id)
);
CREATE INDEX stock_count_lines_count ON stock_count_lines (count_id);
SELECT enable_tenant_rls('stock_count_lines');

-- ── Traslados entre bodegas ──────────────────────────────────────────────────

CREATE TABLE stock_transfers (
  id              uuid PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  number          text,
  from_warehouse_id uuid      NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  to_warehouse_id uuid        NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  status          text        NOT NULL DEFAULT 'DRAFT'
                    CHECK (status IN ('DRAFT','SENT','RECEIVED','CANCELLED')),
  transfer_date   date        NOT NULL,
  notes           text,
  created_by      uuid        REFERENCES memberships(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_transfers_different_warehouses CHECK (from_warehouse_id <> to_warehouse_id)
);
CREATE UNIQUE INDEX stock_transfers_number ON stock_transfers (organization_id, number)
  WHERE number IS NOT NULL;
SELECT enable_tenant_rls('stock_transfers');
SELECT attach_updated_at('stock_transfers');

CREATE TABLE stock_transfer_lines (
  id              uuid PRIMARY KEY,
  organization_id uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  transfer_id     uuid          NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
  product_id      uuid          NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  lot_id          uuid          REFERENCES stock_lots(id) ON DELETE RESTRICT,
  quantity        numeric(19,6) NOT NULL CHECK (quantity > 0)
);
CREATE INDEX stock_transfer_lines_transfer ON stock_transfer_lines (transfer_id);
SELECT enable_tenant_rls('stock_transfer_lines');

-- ═══════════════════════════════════════════════════════════════════════════
-- 0008 · Contabilidad: PUC, diarios, asientos, periodos
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Este esquema existe para sostener cuatro invariantes. No son preferencias de
-- diseño: son las que separan una contabilidad de una hoja de cálculo con
-- números bonitos.
--
-- 1. **Todo asiento contabilizado cuadra.** `SUM(base_debit) = SUM(base_credit)`
--    se comprueba con una restricción DIFERIDA, no inmediata: un asiento se
--    construye línea a línea y está descuadrado durante todo el proceso. Una
--    restricción inmediata obligaría a insertar las dos patas a la vez, o a
--    desactivarla, que es como no tenerla.
--
-- 2. **Un asiento contabilizado es inmutable.** No se edita ni se borra: se
--    reversa con otro asiento que apunta a él. Si se pudiera editar, un balance
--    ya presentado a la DIAN cambiaría solo, y nadie sabría cuándo ni por qué.
--
-- 3. **No se contabiliza en un periodo cerrado.** Cerrar enero significa que
--    enero ya no se mueve. Es exactamente lo que el sistema de referencia no
--    tiene, y por lo que cualquiera puede descuadrar un año declarado.
--
-- 4. **Todo asiento sabe de dónde viene.** `source_type`/`source_id` apuntan al
--    documento que lo originó, así que desde cualquier informe se llega a la
--    factura. Un asiento sin origen es un número que nadie puede explicar.
--
-- Las tres primeras se imponen en la BASE DE DATOS, no solo en la aplicación:
-- la contabilidad la escribirán con el tiempo varios módulos (ventas, compras,
-- nómina, activos), y confiar en que los seis recuerden la regla es confiar en
-- la suerte.

-- `btree_gist` permite mezclar `=` sobre un uuid con `&&` sobre un rango en la
-- misma restricción EXCLUDE, que es como se impide que dos años fiscales se
-- solapen sin una carrera entre transacciones. Es una extensión de contrib
-- marcada como `trusted` desde PostgreSQL 13: no exige superusuario.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ── Plan de cuentas ──────────────────────────────────────────────────────────
--
-- El PUC colombiano (Decreto 2650) es jerárquico por longitud de código:
-- 1 dígito = clase, 2 = grupo, 4 = cuenta, 6 = subcuenta. Se guarda el árbol
-- explícito con `parent_id` además del código porque las consultas del balance
-- recorren el árbol, y deducir el padre cortando la cadena obliga a repetir esa
-- lógica en cada informe.

CREATE TABLE accounts (
  id              uuid PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code            text        NOT NULL CHECK (code ~ '^[0-9]+$'),
  name            text        NOT NULL,
  parent_id       uuid        REFERENCES accounts(id) ON DELETE RESTRICT,
  -- Redundante con length(code), pero indexable y legible en los informes.
  level           smallint    NOT NULL CHECK (level BETWEEN 1 AND 6),

  type            text        NOT NULL CHECK (type IN (
                      'ASSET','LIABILITY','EQUITY','INCOME','EXPENSE','COST','MEMORANDUM')),
  -- Naturaleza: de qué lado aumenta. Determina el signo con el que la cuenta
  -- entra en el balance, no si admite el otro lado (un banco puede quedar en
  -- rojo y eso es un dato, no un error).
  nature          text        NOT NULL CHECK (nature IN ('DEBIT','CREDIT')),

  -- Solo las hojas reciben movimiento. Contabilizar en una cuenta que tiene
  -- hijas duplica el saldo: aparece en la madre y en la suma de las hijas.
  is_postable     boolean     NOT NULL DEFAULT false,
  is_active       boolean     NOT NULL DEFAULT true,

  -- Cuentas auxiliares: sin tercero no hay cartera por cliente ni cuenta por
  -- pagar por proveedor, solo un montón total que nadie puede cobrar.
  requires_party  boolean     NOT NULL DEFAULT false,
  requires_cost_center boolean NOT NULL DEFAULT false,
  -- Marca las cuentas de efectivo para el flujo de caja y la conciliación.
  is_cash         boolean     NOT NULL DEFAULT false,

  description     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,

  UNIQUE (organization_id, code),
  -- El nivel y el código tienen que decir lo mismo.
  CONSTRAINT accounts_level_matches_code CHECK (level = length(code)),
  -- Una cuenta de orden no entra en el balance ni en resultados; se separa para
  -- que ningún informe la sume por descuido.
  CONSTRAINT accounts_memorandum_class CHECK (type <> 'MEMORANDUM' OR left(code, 1) IN ('8','9'))
);
CREATE INDEX accounts_parent ON accounts (organization_id, parent_id);
CREATE INDEX accounts_postable ON accounts (organization_id, code) WHERE is_postable AND deleted_at IS NULL;
SELECT enable_tenant_rls('accounts');
SELECT attach_updated_at('accounts');

-- ── Centros de costo ─────────────────────────────────────────────────────────

CREATE TABLE cost_centers (
  id              uuid PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code            text        NOT NULL,
  name            text        NOT NULL,
  parent_id       uuid        REFERENCES cost_centers(id) ON DELETE RESTRICT,
  branch_id       uuid        REFERENCES branches(id) ON DELETE SET NULL,
  is_active       boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  UNIQUE (organization_id, code)
);
SELECT enable_tenant_rls('cost_centers');
SELECT attach_updated_at('cost_centers');

-- ── Años y periodos ──────────────────────────────────────────────────────────

CREATE TABLE fiscal_years (
  id              uuid PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  start_date      date        NOT NULL,
  end_date        date        NOT NULL,
  status          text        NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  closed_at       timestamptz,
  closed_by       uuid        REFERENCES memberships(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name),
  CONSTRAINT fiscal_years_range CHECK (end_date > start_date)
);
-- Dos años fiscales no pueden solaparse: una fecha pertenece a un año y solo a
-- uno, o el mismo movimiento se declararía dos veces.
ALTER TABLE fiscal_years ADD CONSTRAINT fiscal_years_no_overlap
  EXCLUDE USING gist (
    organization_id WITH =,
    daterange(start_date, end_date, '[]') WITH &&
  );
SELECT enable_tenant_rls('fiscal_years');
SELECT attach_updated_at('fiscal_years');

CREATE TABLE accounting_periods (
  id              uuid PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  fiscal_year_id  uuid        NOT NULL REFERENCES fiscal_years(id) ON DELETE CASCADE,
  -- 1..12 para meses; 13 se reserva para el periodo de ajustes de cierre, que
  -- los contadores usan para no mezclar los ajustes con diciembre.
  period_no       smallint    NOT NULL CHECK (period_no BETWEEN 1 AND 13),
  name            text        NOT NULL,
  start_date      date        NOT NULL,
  end_date        date        NOT NULL,
  status          text        NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  closed_at       timestamptz,
  closed_by       uuid        REFERENCES memberships(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fiscal_year_id, period_no),
  CONSTRAINT accounting_periods_range CHECK (end_date >= start_date)
);
CREATE INDEX accounting_periods_dates ON accounting_periods (organization_id, start_date, end_date);
SELECT enable_tenant_rls('accounting_periods');
SELECT attach_updated_at('accounting_periods');

-- ── Diarios ──────────────────────────────────────────────────────────────────
--
-- Separar ventas, compras, caja y ajustes no es burocracia: es lo que permite
-- revisar "todas las ventas de marzo" sin leer 4.000 asientos, y lo que da a
-- cada bloque su propio consecutivo.

CREATE TABLE journals (
  id              uuid PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code            text        NOT NULL,
  name            text        NOT NULL,
  type            text        NOT NULL CHECK (type IN (
                      'SALES','PURCHASES','CASH','PAYROLL','GENERAL','OPENING','CLOSING','INVENTORY')),
  -- Prefijo del consecutivo de asientos de este diario, p. ej. `VT-`.
  sequence_prefix text        NOT NULL,
  is_active       boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);
SELECT enable_tenant_rls('journals');
SELECT attach_updated_at('journals');

-- ── Asientos ─────────────────────────────────────────────────────────────────

CREATE TABLE journal_entries (
  id              uuid PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  journal_id      uuid        NOT NULL REFERENCES journals(id) ON DELETE RESTRICT,
  period_id       uuid        NOT NULL REFERENCES accounting_periods(id) ON DELETE RESTRICT,
  -- Vacío mientras es borrador: el consecutivo se asigna al contabilizar, igual
  -- que en las facturas y por la misma razón.
  number          text,
  entry_date      date        NOT NULL,
  status          text        NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','POSTED')),
  memo            text        NOT NULL,

  currency_code   char(3)     NOT NULL DEFAULT 'COP' REFERENCES currencies(code),
  exchange_rate   numeric(19,6) NOT NULL DEFAULT 1 CHECK (exchange_rate > 0),

  -- Totales denormalizados. No son un atajo: son lo que hace que el balance de
  -- prueba no tenga que sumar millones de líneas, y el disparador diferido
  -- comprueba que coincidan con ellas.
  debit_total     numeric(19,4) NOT NULL DEFAULT 0 CHECK (debit_total >= 0),
  credit_total    numeric(19,4) NOT NULL DEFAULT 0 CHECK (credit_total >= 0),

  -- Origen. `MANUAL` es el único caso en el que no hay documento detrás.
  source_type     text        NOT NULL DEFAULT 'MANUAL',
  source_id       uuid,
  -- Reversión: el asiento que anula a otro, y la marca en el anulado.
  reversal_of_id  uuid        REFERENCES journal_entries(id) ON DELETE RESTRICT,
  reversed_by_id  uuid        REFERENCES journal_entries(id) ON DELETE RESTRICT,

  posted_at       timestamptz,
  posted_by       uuid        REFERENCES memberships(id) ON DELETE SET NULL,
  created_by      uuid        REFERENCES memberships(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT journal_entries_posted_has_number
    CHECK (status = 'DRAFT' OR (number IS NOT NULL AND posted_at IS NOT NULL)),
  CONSTRAINT journal_entries_not_self_reversal CHECK (reversal_of_id IS DISTINCT FROM id)
);
CREATE UNIQUE INDEX journal_entries_number ON journal_entries (organization_id, number)
  WHERE number IS NOT NULL;
CREATE INDEX journal_entries_period ON journal_entries (organization_id, period_id, entry_date);
CREATE INDEX journal_entries_journal ON journal_entries (organization_id, journal_id, entry_date);
-- El índice del drill-down inverso: "¿qué asiento generó esta factura?".
CREATE INDEX journal_entries_source ON journal_entries (organization_id, source_type, source_id)
  WHERE source_id IS NOT NULL;
-- Un documento genera UN asiento vigente. Sin esto, reintentar una emisión que
-- falló a medias contabilizaría la misma factura dos veces y el balance
-- cuadraría estando mal, que es la peor forma de estar mal.
CREATE UNIQUE INDEX journal_entries_one_per_source
  ON journal_entries (organization_id, source_type, source_id)
  WHERE source_id IS NOT NULL AND status = 'POSTED' AND reversed_by_id IS NULL AND reversal_of_id IS NULL;
SELECT enable_tenant_rls('journal_entries');
SELECT attach_updated_at('journal_entries');

CREATE TABLE journal_lines (
  id              uuid PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entry_id        uuid        NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  position        smallint    NOT NULL,
  account_id      uuid        NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  -- El tercero: quién debe o a quién se le debe. Sin él no hay auxiliar.
  party_id        uuid        REFERENCES parties(id) ON DELETE RESTRICT,
  cost_center_id  uuid        REFERENCES cost_centers(id) ON DELETE RESTRICT,
  branch_id       uuid        REFERENCES branches(id) ON DELETE SET NULL,
  description     text        NOT NULL,

  -- En la moneda del asiento.
  debit           numeric(19,4) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit          numeric(19,4) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  -- En la moneda funcional de la empresa. El cuadre se comprueba AQUÍ: con dos
  -- monedas, las columnas de origen no tienen por qué sumar lo mismo.
  base_debit      numeric(19,4) NOT NULL DEFAULT 0 CHECK (base_debit >= 0),
  base_credit     numeric(19,4) NOT NULL DEFAULT 0 CHECK (base_credit >= 0),

  -- Referencia al documento fuente de ESTA línea (la factura concreta que esta
  -- línea de cartera representa), para el auxiliar por tercero.
  reference       text,
  created_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (entry_id, position),
  -- Una línea mueve un lado y solo uno. Permitir ambos convierte cada línea en
  -- un mini-asiento y hace imposible leer el libro mayor.
  CONSTRAINT journal_lines_one_side CHECK ((debit = 0) <> (credit = 0)),
  CONSTRAINT journal_lines_base_matches_side CHECK (
    (debit = 0) = (base_debit = 0) AND (credit = 0) = (base_credit = 0)
  )
);
CREATE INDEX journal_lines_entry ON journal_lines (entry_id, position);
-- El índice del libro mayor y del balance de prueba.
CREATE INDEX journal_lines_account ON journal_lines (organization_id, account_id);
-- El del auxiliar por tercero.
CREATE INDEX journal_lines_party ON journal_lines (organization_id, party_id, account_id)
  WHERE party_id IS NOT NULL;
CREATE INDEX journal_lines_cost_center ON journal_lines (organization_id, cost_center_id)
  WHERE cost_center_id IS NOT NULL;
SELECT enable_tenant_rls('journal_lines');

-- ── Cuentas por defecto de cada operación ────────────────────────────────────
--
-- El motor de contabilización no lleva códigos del PUC dentro: pregunta por un
-- ROL ("la cuenta de clientes") y esta tabla responde cuál es en esta empresa.
-- Escribir `1305` en el código funcionaría hoy y sería imposible de cambiar el
-- día que una empresa use un plan distinto, que en Colombia pasa en cuanto
-- alguien adopta NIIF plenas.

CREATE TABLE account_mappings (
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role            text        NOT NULL,
  account_id      uuid        NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, role)
);
SELECT enable_tenant_rls('account_mappings');
SELECT attach_updated_at('account_mappings');

-- ═══════════════════════════════════════════════════════════════════════════
-- Los invariantes, impuestos por la base de datos
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1 · El asiento cuadra (diferido) ─────────────────────────────────────────
--
-- DIFERIDO es lo esencial: se comprueba al confirmar la transacción, no línea a
-- línea. Un asiento de cuatro líneas está descuadrado mientras se escribe; una
-- comprobación inmediata rechazaría la primera línea.

CREATE OR REPLACE FUNCTION assert_journal_entry_balanced() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  target  uuid;
  entry   journal_entries%ROWTYPE;
  sum_d   numeric(19,4);
  sum_c   numeric(19,4);
  sum_bd  numeric(19,4);
  sum_bc  numeric(19,4);
BEGIN
  IF TG_TABLE_NAME = 'journal_entries' THEN
    target := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    target := OLD.entry_id;
  ELSE
    target := NEW.entry_id;
  END IF;

  SELECT * INTO entry FROM journal_entries WHERE id = target;
  -- La cabecera se borró en esta misma transacción (un borrador descartado):
  -- no queda nada que cuadrar.
  IF NOT FOUND THEN RETURN NULL; END IF;
  -- Un borrador puede estar descuadrado: es lo que se está construyendo.
  IF entry.status <> 'POSTED' THEN RETURN NULL; END IF;

  SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0),
         COALESCE(SUM(base_debit), 0), COALESCE(SUM(base_credit), 0)
    INTO sum_d, sum_c, sum_bd, sum_bc
    FROM journal_lines WHERE entry_id = target;

  IF sum_bd <> sum_bc THEN
    RAISE EXCEPTION
      'El asiento % no cuadra: débitos % contra créditos %',
      COALESCE(entry.number, '(borrador)'), sum_bd, sum_bc
      USING ERRCODE = 'check_violation';
  END IF;

  IF sum_bd = 0 THEN
    RAISE EXCEPTION 'El asiento % no tiene movimiento', COALESCE(entry.number, '(borrador)')
      USING ERRCODE = 'check_violation';
  END IF;

  -- Los totales de la cabecera son los que leen los informes. Si divergen de
  -- las líneas, el balance de prueba cuadra y el libro mayor no.
  IF entry.debit_total <> sum_d OR entry.credit_total <> sum_c THEN
    RAISE EXCEPTION
      'Los totales del asiento % (% / %) no coinciden con sus líneas (% / %)',
      COALESCE(entry.number, '(borrador)'), entry.debit_total, entry.credit_total, sum_d, sum_c
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER journal_entries_balanced
  AFTER INSERT OR UPDATE ON journal_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_journal_entry_balanced();

-- También al tocar las líneas: sin esto, borrar una línea de un asiento ya
-- contabilizado lo descuadraría sin que nadie se enterara.
CREATE CONSTRAINT TRIGGER journal_lines_balanced
  AFTER INSERT OR UPDATE OR DELETE ON journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_journal_entry_balanced();

-- ── 2 · Un asiento contabilizado es inmutable ────────────────────────────────

CREATE OR REPLACE FUNCTION assert_posted_entry_immutable() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'POSTED' THEN
      RAISE EXCEPTION
        'El asiento % está contabilizado y no se borra: se reversa', OLD.number
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'POSTED' THEN
    -- Lo único que puede cambiar en un asiento contabilizado es la marca de que
    -- ya fue reversado: el dato lo escribe la reversión, no una edición.
    IF (NEW.journal_id, NEW.period_id, NEW.number, NEW.entry_date, NEW.status,
        NEW.memo, NEW.currency_code, NEW.exchange_rate,
        NEW.debit_total, NEW.credit_total,
        NEW.source_type, NEW.source_id, NEW.reversal_of_id, NEW.posted_at)
       IS DISTINCT FROM
       (OLD.journal_id, OLD.period_id, OLD.number, OLD.entry_date, OLD.status,
        OLD.memo, OLD.currency_code, OLD.exchange_rate,
        OLD.debit_total, OLD.credit_total,
        OLD.source_type, OLD.source_id, OLD.reversal_of_id, OLD.posted_at)
    THEN
      RAISE EXCEPTION
        'El asiento % está contabilizado y no se modifica: corrígelo con una reversión',
        OLD.number
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER journal_entries_immutable
  BEFORE UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION assert_posted_entry_immutable();

CREATE OR REPLACE FUNCTION assert_posted_lines_immutable() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  touched       uuid;
  parent_status text;
  parent_number text;
BEGIN
  IF TG_OP = 'DELETE' THEN touched := OLD.entry_id; ELSE touched := NEW.entry_id; END IF;

  SELECT status, number INTO parent_status, parent_number
    FROM journal_entries WHERE id = touched;

  -- Si la cabecera ya no existe, es que el asiento entero se está borrando en
  -- cascada; el disparador de la cabecera ya decidió si eso era legal.
  IF NOT FOUND THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF parent_status = 'POSTED' THEN
    RAISE EXCEPTION
      'Las líneas del asiento % no se tocan: está contabilizado', parent_number
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;

CREATE TRIGGER journal_lines_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION assert_posted_lines_immutable();

-- ── 3 · No se contabiliza en un periodo cerrado ──────────────────────────────

CREATE OR REPLACE FUNCTION assert_period_accepts_entry() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  p accounting_periods%ROWTYPE;
  y_status text;
BEGIN
  SELECT * INTO p FROM accounting_periods WHERE id = NEW.period_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El periodo contable no existe' USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- La fecha tiene que caer dentro del periodo. Un asiento de febrero metido en
  -- enero descuadra los dos meses a la vez.
  IF NEW.entry_date < p.start_date OR NEW.entry_date > p.end_date THEN
    RAISE EXCEPTION
      'La fecha % no pertenece al periodo % (% a %)',
      NEW.entry_date, p.name, p.start_date, p.end_date
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT status INTO y_status FROM fiscal_years WHERE id = p.fiscal_year_id;

  IF p.status = 'CLOSED' OR y_status = 'CLOSED' THEN
    RAISE EXCEPTION 'El periodo % está cerrado', p.name
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

-- Solo al crear o al cambiar algo que importe: marcar `reversed_by_id` en un
-- asiento de un periodo ya cerrado es legítimo, porque no mueve ni un peso.
CREATE TRIGGER journal_entries_period_open
  BEFORE INSERT ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION assert_period_accepts_entry();

CREATE TRIGGER journal_entries_period_open_upd
  BEFORE UPDATE OF period_id, entry_date, status, debit_total, credit_total ON journal_entries
  FOR EACH ROW
  WHEN (NEW.status = 'POSTED')
  EXECUTE FUNCTION assert_period_accepts_entry();

-- ── 4 · La cuenta admite el movimiento ───────────────────────────────────────

CREATE OR REPLACE FUNCTION assert_line_account_postable() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  a accounts%ROWTYPE;
BEGIN
  SELECT * INTO a FROM accounts WHERE id = NEW.account_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La cuenta contable no existe' USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NOT a.is_postable THEN
    RAISE EXCEPTION
      'La cuenta % (%) es de agrupación y no recibe movimiento', a.code, a.name
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT a.is_active OR a.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'La cuenta % (%) está inactiva', a.code, a.name
      USING ERRCODE = 'check_violation';
  END IF;

  IF a.requires_party AND NEW.party_id IS NULL THEN
    RAISE EXCEPTION
      'La cuenta % (%) exige un tercero: sin él no hay auxiliar que cobrar ni que pagar',
      a.code, a.name
      USING ERRCODE = 'check_violation';
  END IF;

  IF a.requires_cost_center AND NEW.cost_center_id IS NULL THEN
    RAISE EXCEPTION 'La cuenta % (%) exige un centro de costo', a.code, a.name
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER journal_lines_account_postable
  BEFORE INSERT OR UPDATE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION assert_line_account_postable();

-- ── 5 · Una cuenta con movimiento no puede volverse de agrupación ────────────
--
-- Crear una subcuenta bajo una cuenta que ya tiene movimiento dejaría el saldo
-- contado dos veces en el balance. Se impide en el momento de crear la hija.

CREATE OR REPLACE FUNCTION assert_parent_account_unused() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  parent accounts%ROWTYPE;
  moves  bigint;
BEGIN
  IF NEW.parent_id IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO parent FROM accounts WHERE id = NEW.parent_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La cuenta madre no existe' USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF left(NEW.code, length(parent.code)) <> parent.code THEN
    RAISE EXCEPTION
      'El código % no cuelga de % : en el PUC la jerarquía ES el código',
      NEW.code, parent.code
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) INTO moves FROM journal_lines WHERE account_id = NEW.parent_id;
  IF moves > 0 THEN
    RAISE EXCEPTION
      'La cuenta % ya tiene % movimientos: no se le pueden colgar subcuentas sin duplicar su saldo',
      parent.code, moves
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER accounts_parent_unused
  BEFORE INSERT OR UPDATE OF parent_id, code ON accounts
  FOR EACH ROW EXECUTE FUNCTION assert_parent_account_unused();

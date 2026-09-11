-- ═══════════════════════════════════════════════════════════════════════════
-- 0005 · CRM: partes, contactos, actividades y embudos
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Modelo de PARTES unificado, no dos tablas "clientes" y "proveedores".
--
-- En un ERP real, la misma empresa suele ser cliente y proveedor a la vez, y a
-- veces también empleado o socio. Con tablas separadas acaba habiendo dos fichas
-- del mismo NIT que se desincronizan: cambian la dirección en una y la otra
-- sigue con la vieja, y las facturas salen mal. El sistema de referencia hace
-- eso mismo (tiene "Clientes" y "Vendedores" aparte) y es una fuente segura de
-- datos inconsistentes.
--
-- Aquí hay UNA parte con banderas `is_customer` / `is_vendor` y un perfil por
-- cada rol que desempeñe, con los datos que solo tienen sentido en ese rol
-- (cuenta por cobrar, plazo de pago, lista de precios).

CREATE TABLE parties (
  id                     uuid PRIMARY KEY,
  organization_id        uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind                   text        NOT NULL DEFAULT 'COMPANY' CHECK (kind IN ('PERSON','COMPANY')),
  -- Nombre para mostrar: el comercial de una empresa, el completo de una persona.
  display_name           text        NOT NULL,
  legal_name             text,
  -- Documentos de identificación colombianos (DIAN).
  tax_id_type            text        NOT NULL DEFAULT 'NIT'
                           CHECK (tax_id_type IN ('NIT','CC','CE','TI','PP','NIT_EXT','PEP','NUIP','SIN_IDENTIFICAR')),
  tax_id                 text,
  tax_id_dv              text,
  -- Responsabilidades fiscales DIAN (O-13, O-15, O-23, O-47, R-99-PN).
  fiscal_responsibilities text[]     NOT NULL DEFAULT '{}',
  -- Régimen: simplificado, común, gran contribuyente, autorretenedor.
  tax_regime             text        NOT NULL DEFAULT 'COMUN'
                           CHECK (tax_regime IN ('SIMPLIFICADO','COMUN','GRAN_CONTRIBUYENTE','NO_RESIDENTE')),
  email                  text,
  phone                  text,
  mobile                 text,
  website                text,
  industry               text,
  notes                  text,
  is_customer            boolean     NOT NULL DEFAULT false,
  is_vendor              boolean     NOT NULL DEFAULT false,
  status                 text        NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE','BLOCKED')),
  owner_membership_id    uuid        REFERENCES memberships(id) ON DELETE SET NULL,
  branch_id              uuid        REFERENCES branches(id) ON DELETE SET NULL,
  created_by             uuid        REFERENCES memberships(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  deleted_at             timestamptz
);
-- Un mismo documento no puede estar dos veces en la misma empresa. Parcial para
-- que los borrados lógicos y las partes sin documento no estorben.
CREATE UNIQUE INDEX parties_tax_id ON parties (organization_id, tax_id_type, tax_id)
  WHERE tax_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX parties_search ON parties (organization_id, display_name) WHERE deleted_at IS NULL;
CREATE INDEX parties_owner ON parties (organization_id, owner_membership_id) WHERE deleted_at IS NULL;
SELECT enable_tenant_rls('parties');
SELECT attach_updated_at('parties');

CREATE TABLE party_addresses (
  id              uuid PRIMARY KEY,
  organization_id uuid    NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  party_id        uuid    NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  kind            text    NOT NULL DEFAULT 'MAIN' CHECK (kind IN ('MAIN','BILLING','SHIPPING','OTHER')),
  label           text,
  line1           text    NOT NULL,
  line2           text,
  city            text,
  state           text,
  country         char(2) NOT NULL DEFAULT 'CO',
  postal_code     text,
  is_default      boolean NOT NULL DEFAULT false
);
CREATE INDEX party_addresses_party ON party_addresses (party_id);
SELECT enable_tenant_rls('party_addresses');

CREATE TABLE contacts (
  id              uuid PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  party_id        uuid        REFERENCES parties(id) ON DELETE CASCADE,
  first_name      text        NOT NULL,
  last_name       text        NOT NULL DEFAULT '',
  job_title       text,
  email           text,
  phone           text,
  mobile          text,
  is_primary      boolean     NOT NULL DEFAULT false,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX contacts_party ON contacts (organization_id, party_id);
CREATE UNIQUE INDEX contacts_one_primary ON contacts (party_id) WHERE is_primary;
SELECT enable_tenant_rls('contacts');
SELECT attach_updated_at('contacts');

-- Datos que solo tienen sentido cuando la parte actúa como cliente.
CREATE TABLE customer_profiles (
  organization_id      uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  party_id             uuid PRIMARY KEY REFERENCES parties(id) ON DELETE CASCADE,
  price_list_id        uuid,
  payment_terms_days   smallint      NOT NULL DEFAULT 0 CHECK (payment_terms_days >= 0),
  credit_limit         numeric(19,4) NOT NULL DEFAULT 0 CHECK (credit_limit >= 0),
  receivable_account_id uuid,
  default_currency     char(3)       NOT NULL DEFAULT 'COP' REFERENCES currencies(code),
  salesperson_membership_id uuid     REFERENCES memberships(id) ON DELETE SET NULL,
  tax_group_id         uuid          REFERENCES tax_groups(id) ON DELETE SET NULL
);
SELECT enable_tenant_rls('customer_profiles');

CREATE TABLE vendor_profiles (
  organization_id    uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  party_id           uuid PRIMARY KEY REFERENCES parties(id) ON DELETE CASCADE,
  payment_terms_days smallint      NOT NULL DEFAULT 0 CHECK (payment_terms_days >= 0),
  payable_account_id uuid,
  default_currency   char(3)       NOT NULL DEFAULT 'COP' REFERENCES currencies(code),
  tax_group_id       uuid          REFERENCES tax_groups(id) ON DELETE SET NULL,
  lead_time_days     smallint      NOT NULL DEFAULT 0
);
SELECT enable_tenant_rls('vendor_profiles');

-- ── Actividades: llamadas, correos, reuniones, notas ────────────────────────
CREATE TABLE activities (
  id                  uuid PRIMARY KEY,
  organization_id     uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind                text        NOT NULL
                        CHECK (kind IN ('CALL','EMAIL','MEETING','NOTE','WHATSAPP','TASK','VISIT')),
  entity_type         text        NOT NULL,
  entity_id           uuid        NOT NULL,
  subject             text        NOT NULL,
  body                text,
  due_at              timestamptz,
  completed_at        timestamptz,
  owner_membership_id uuid        REFERENCES memberships(id) ON DELETE SET NULL,
  created_by          uuid        REFERENCES memberships(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activities_entity ON activities (organization_id, entity_type, entity_id, created_at DESC);
CREATE INDEX activities_pending ON activities (organization_id, owner_membership_id, due_at)
  WHERE completed_at IS NULL;
SELECT enable_tenant_rls('activities');
SELECT attach_updated_at('activities');

-- ── Embudos y oportunidades ────────────────────────────────────────────────
CREATE TABLE pipelines (
  id              uuid PRIMARY KEY,
  organization_id uuid    NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text    NOT NULL,
  is_default      boolean NOT NULL DEFAULT false,
  UNIQUE (organization_id, name)
);
CREATE UNIQUE INDEX pipelines_one_default ON pipelines (organization_id) WHERE is_default;
SELECT enable_tenant_rls('pipelines');

CREATE TABLE pipeline_stages (
  id              uuid PRIMARY KEY,
  organization_id uuid     NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pipeline_id     uuid     NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  name            text     NOT NULL,
  position        smallint NOT NULL DEFAULT 0,
  probability     smallint NOT NULL DEFAULT 0 CHECK (probability BETWEEN 0 AND 100),
  is_won          boolean  NOT NULL DEFAULT false,
  is_lost         boolean  NOT NULL DEFAULT false,
  CHECK (NOT (is_won AND is_lost))
);
CREATE INDEX pipeline_stages_pipeline ON pipeline_stages (pipeline_id, position);
SELECT enable_tenant_rls('pipeline_stages');

CREATE TABLE opportunities (
  id                  uuid PRIMARY KEY,
  organization_id     uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  party_id            uuid          REFERENCES parties(id) ON DELETE SET NULL,
  contact_id          uuid          REFERENCES contacts(id) ON DELETE SET NULL,
  name                text          NOT NULL,
  pipeline_id         uuid          NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  stage_id            uuid          NOT NULL REFERENCES pipeline_stages(id) ON DELETE RESTRICT,
  amount              numeric(19,4) NOT NULL DEFAULT 0,
  currency_code       char(3)       NOT NULL DEFAULT 'COP' REFERENCES currencies(code),
  expected_close_date date,
  source              text,
  status              text          NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','WON','LOST')),
  lost_reason         text,
  closed_at           timestamptz,
  owner_membership_id uuid          REFERENCES memberships(id) ON DELETE SET NULL,
  position            numeric       NOT NULL DEFAULT 0,
  created_at          timestamptz   NOT NULL DEFAULT now(),
  updated_at          timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX opportunities_stage ON opportunities (organization_id, stage_id, position);
CREATE INDEX opportunities_party ON opportunities (organization_id, party_id);
SELECT enable_tenant_rls('opportunities');
SELECT attach_updated_at('opportunities');

-- ── Importaciones masivas ──────────────────────────────────────────────────
CREATE TABLE imports (
  id              uuid PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type     text        NOT NULL,
  filename        text        NOT NULL,
  -- Mapeo columna del fichero → campo de la entidad.
  mapping         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status          text        NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING','VALIDATING','READY','RUNNING','DONE','FAILED')),
  total_rows      integer     NOT NULL DEFAULT 0,
  ok_rows         integer     NOT NULL DEFAULT 0,
  error_rows      integer     NOT NULL DEFAULT 0,
  created_by      uuid        REFERENCES memberships(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz
);
SELECT enable_tenant_rls('imports');

CREATE TABLE import_rows (
  organization_id   uuid    NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  import_id         uuid    NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
  row_no            integer NOT NULL,
  raw               jsonb   NOT NULL,
  status            text    NOT NULL DEFAULT 'PENDING'
                      CHECK (status IN ('PENDING','OK','ERROR','SKIPPED')),
  error             text,
  created_entity_id uuid,
  PRIMARY KEY (import_id, row_no)
);
CREATE INDEX import_rows_errors ON import_rows (import_id) WHERE status = 'ERROR';
SELECT enable_tenant_rls('import_rows');

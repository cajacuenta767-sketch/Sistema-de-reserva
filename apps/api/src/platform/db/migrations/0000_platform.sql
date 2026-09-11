-- ═══════════════════════════════════════════════════════════════════════════
-- 0000 · Plataforma: multi-tenancy, utilidades comunes y aislamiento por RLS
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Frontera de seguridad del sistema:
--
--   · Tablas DE PLATAFORMA (users, organizations, memberships, outbox_events):
--     no llevan RLS porque hay que consultarlas ANTES de saber en qué
--     organización está el usuario (login, listar sus organizaciones). El
--     módulo `identity` es el único que las toca y filtra siempre por user_id.
--
--   · Tablas DE NEGOCIO (todas las demás): llevan `organization_id NOT NULL`,
--     RLS activada y FORZADA. El rol de aplicación no es dueño de las tablas y
--     no tiene BYPASSRLS, así que olvidar un `WHERE organization_id` no filtra
--     datos de otro tenant: devuelve cero filas.

-- ── Utilidades ─────────────────────────────────────────────────────────────

-- Organización activa de la transacción en curso. NULL si no se ha fijado,
-- lo que hace que toda política RLS falle: sin tenant no hay datos.
CREATE OR REPLACE FUNCTION app_current_org() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.organization_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app_current_membership() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.membership_id', true), '')::uuid $$;

-- Activa el aislamiento por organización en una tabla de negocio.
-- Se llama una vez por tabla; concentrarlo aquí evita que alguien lo olvide.
CREATE OR REPLACE FUNCTION enable_tenant_rls(tbl regclass) RETURNS void
  LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tbl);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', tbl);
  EXECUTE format(
    'CREATE POLICY tenant_isolation ON %s USING (organization_id = app_current_org()) '
    'WITH CHECK (organization_id = app_current_org())', tbl);
END $$;

-- Mantiene `updated_at` sin que ningún repositorio tenga que acordarse.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION attach_updated_at(tbl regclass) RETURNS void
  LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format(
    'CREATE TRIGGER trg_updated_at BEFORE UPDATE ON %s '
    'FOR EACH ROW EXECUTE FUNCTION set_updated_at()', tbl);
END $$;

-- ── Organizaciones ─────────────────────────────────────────────────────────

CREATE TABLE organizations (
  id                      uuid PRIMARY KEY,
  legal_name              text        NOT NULL,
  trade_name              text        NOT NULL,
  -- NIT en Colombia. El dígito de verificación va aparte porque se imprime así.
  tax_id                  text,
  tax_id_dv               text,
  tax_id_type             text        NOT NULL DEFAULT 'NIT',
  country                 char(2)     NOT NULL DEFAULT 'CO',
  city                    text,
  address                 text,
  phone                   text,
  email                   text,
  website                 text,
  functional_currency     char(3)     NOT NULL DEFAULT 'COP',
  timezone                text        NOT NULL DEFAULT 'America/Bogota',
  locale                  text        NOT NULL DEFAULT 'es-CO',
  fiscal_year_start_month smallint    NOT NULL DEFAULT 1
                            CHECK (fiscal_year_start_month BETWEEN 1 AND 12),
  -- Marca blanca: el matiz OKLCH recolorea toda la app sin recompilar.
  brand_hue               smallint    CHECK (brand_hue BETWEEN 0 AND 360),
  logo_file_id            uuid,
  plan                    text        NOT NULL DEFAULT 'FREE'
                            CHECK (plan IN ('FREE','STARTER','PRO','ENTERPRISE')),
  status                  text        NOT NULL DEFAULT 'ACTIVE'
                            CHECK (status IN ('ACTIVE','SUSPENDED','CLOSED')),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX organizations_tax_id_key ON organizations (country, tax_id) WHERE tax_id IS NOT NULL;
SELECT attach_updated_at('organizations');

CREATE TABLE branches (
  id              uuid PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code            text        NOT NULL,
  name            text        NOT NULL,
  address         text,
  city            text,
  phone           text,
  is_default      boolean     NOT NULL DEFAULT false,
  is_active       boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);
-- Exactamente una sucursal por defecto por organización.
CREATE UNIQUE INDEX branches_one_default ON branches (organization_id) WHERE is_default;
SELECT enable_tenant_rls('branches');
SELECT attach_updated_at('branches');

CREATE TABLE organization_settings (
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key             text        NOT NULL,
  value           jsonb       NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, key)
);
SELECT enable_tenant_rls('organization_settings');

-- ── Bus de eventos: bandeja de salida transaccional ────────────────────────
-- El evento se escribe en la MISMA transacción que el cambio que lo provoca:
-- o pasan los dos o no pasa ninguno. Nunca hay un asiento contable sin factura
-- ni una factura sin su evento.
--
-- Sin RLS: la procesa un trabajador de plataforma que atraviesa organizaciones.
CREATE TABLE outbox_events (
  id              bigserial PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_type      text        NOT NULL,
  aggregate_type  text        NOT NULL,
  aggregate_id    uuid        NOT NULL,
  payload         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  actor_membership_id uuid,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  processed_at    timestamptz,
  attempts        integer     NOT NULL DEFAULT 0,
  last_error      text
);
CREATE INDEX outbox_pending ON outbox_events (occurred_at) WHERE processed_at IS NULL;
CREATE INDEX outbox_aggregate ON outbox_events (aggregate_type, aggregate_id);

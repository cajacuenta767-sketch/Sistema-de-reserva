-- ═══════════════════════════════════════════════════════════════════════════
-- 0004 · Taxonomía transversal: etiquetas, comentarios y campos personalizados
-- ═══════════════════════════════════════════════════════════════════════════
-- Un solo módulo, usado por todos. Las referencias son polimórficas
-- (`entity_type` + `entity_id`) porque la alternativa —una tabla puente por
-- entidad— serían ~25 tablas más y un gestor de etiquetas que no podría ser
-- genérico. El precio es que no hay integridad referencial en `entity_id`; se
-- mitiga limpiando desde el borrado del agregado y con un índice por entidad.

CREATE TABLE tags (
  id              uuid PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- Agrupa etiquetas por contexto: las de clientes no se mezclan con las de tickets.
  kind            text        NOT NULL DEFAULT 'GENERAL',
  name            text        NOT NULL,
  color_hue       smallint    CHECK (color_hue BETWEEN 0 AND 360),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, kind, name)
);
SELECT enable_tenant_rls('tags');

CREATE TABLE taggings (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  tag_id          uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  entity_type     text NOT NULL,
  entity_id       uuid NOT NULL,
  PRIMARY KEY (tag_id, entity_type, entity_id)
);
CREATE INDEX taggings_entity ON taggings (organization_id, entity_type, entity_id);
SELECT enable_tenant_rls('taggings');

CREATE TABLE comments (
  id                  uuid PRIMARY KEY,
  organization_id     uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type         text        NOT NULL,
  entity_id           uuid        NOT NULL,
  author_membership_id uuid       REFERENCES memberships(id) ON DELETE SET NULL,
  body                text        NOT NULL,
  parent_id           uuid        REFERENCES comments(id) ON DELETE CASCADE,
  mentions            uuid[]      NOT NULL DEFAULT '{}',
  created_at          timestamptz NOT NULL DEFAULT now(),
  edited_at           timestamptz
);
CREATE INDEX comments_entity ON comments (organization_id, entity_type, entity_id, created_at);
SELECT enable_tenant_rls('comments');

-- Campos propios de cada empresa, sin tocar el esquema.
CREATE TABLE custom_fields (
  id              uuid PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type     text        NOT NULL,
  key             text        NOT NULL,
  label           text        NOT NULL,
  type            text        NOT NULL DEFAULT 'TEXT'
                    CHECK (type IN ('TEXT','NUMBER','DATE','BOOLEAN','SELECT','MULTISELECT','URL','EMAIL')),
  options         jsonb       NOT NULL DEFAULT '[]'::jsonb,
  is_required     boolean     NOT NULL DEFAULT false,
  position        smallint    NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, entity_type, key)
);
SELECT enable_tenant_rls('custom_fields');

CREATE TABLE custom_field_values (
  organization_id uuid  NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  field_id        uuid  NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
  entity_id       uuid  NOT NULL,
  value           jsonb,
  PRIMARY KEY (field_id, entity_id)
);
CREATE INDEX custom_field_values_entity ON custom_field_values (organization_id, entity_id);
SELECT enable_tenant_rls('custom_field_values');

-- ═══════════════════════════════════════════════════════════════════════════
-- Monedas, tasas de cambio e impuestos
-- ═══════════════════════════════════════════════════════════════════════════

-- Catálogo global: las monedas no pertenecen a ninguna empresa.
CREATE TABLE currencies (
  code           char(3) PRIMARY KEY,
  name           text     NOT NULL,
  symbol         text     NOT NULL,
  decimal_places smallint NOT NULL DEFAULT 2
);

INSERT INTO currencies (code, name, symbol, decimal_places) VALUES
  ('COP', 'Peso colombiano', '$', 2),
  ('USD', 'Dólar estadounidense', 'US$', 2),
  ('EUR', 'Euro', '€', 2),
  ('MXN', 'Peso mexicano', 'MX$', 2),
  ('PEN', 'Sol peruano', 'S/', 2),
  ('CLP', 'Peso chileno', 'CLP$', 0),
  ('ARS', 'Peso argentino', 'AR$', 2),
  ('BRL', 'Real brasileño', 'R$', 2);

CREATE TABLE exchange_rates (
  id              uuid PRIMARY KEY,
  organization_id uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  currency_code   char(3)       NOT NULL REFERENCES currencies(code),
  rate_date       date          NOT NULL,
  -- Cuántas unidades de la moneda funcional vale una de esta moneda.
  rate            numeric(19,10) NOT NULL CHECK (rate > 0),
  source          text          NOT NULL DEFAULT 'MANUAL',
  created_at      timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (organization_id, currency_code, rate_date)
);
SELECT enable_tenant_rls('exchange_rates');

CREATE TABLE taxes (
  id                  uuid PRIMARY KEY,
  organization_id     uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code                text        NOT NULL,
  name                text        NOT NULL,
  kind                text        NOT NULL
                        CHECK (kind IN ('VAT','INC','WITHHOLDING_INCOME','WITHHOLDING_VAT','WITHHOLDING_ICA','OTHER')),
  -- Porcentaje: 19 para el 19 %. Seis decimales porque el ReteICA se expresa
  -- por mil (p. ej. 9,66 por mil = 0,966 %).
  rate                numeric(9,6) NOT NULL CHECK (rate >= 0),
  is_withholding      boolean     NOT NULL DEFAULT false,
  is_compound         boolean     NOT NULL DEFAULT false,
  applies_to          text        NOT NULL DEFAULT 'BOTH' CHECK (applies_to IN ('SALE','PURCHASE','BOTH')),
  -- Base mínima a partir de la cual aplica la retención (UVT convertidas a pesos).
  min_base            numeric(19,4),
  sale_account_id     uuid,
  purchase_account_id uuid,
  dian_tax_code       text,
  is_active           boolean     NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);
SELECT enable_tenant_rls('taxes');
SELECT attach_updated_at('taxes');

CREATE TABLE tax_groups (
  id              uuid PRIMARY KEY,
  organization_id uuid    NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text    NOT NULL,
  is_default      boolean NOT NULL DEFAULT false,
  UNIQUE (organization_id, name)
);
CREATE UNIQUE INDEX tax_groups_one_default ON tax_groups (organization_id) WHERE is_default;
SELECT enable_tenant_rls('tax_groups');

CREATE TABLE tax_group_items (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  tax_group_id    uuid NOT NULL REFERENCES tax_groups(id) ON DELETE CASCADE,
  tax_id          uuid NOT NULL REFERENCES taxes(id) ON DELETE CASCADE,
  PRIMARY KEY (tax_group_id, tax_id)
);
SELECT enable_tenant_rls('tax_group_items');

-- ═══════════════════════════════════════════════════════════════════════════
-- 0006 · Catálogo: unidades, categorías, productos, variantes y precios
-- ═══════════════════════════════════════════════════════════════════════════
--
-- El catálogo es la tabla de la que cuelga todo lo demás: una línea de factura,
-- de orden de compra, de movimiento de inventario o de nota crédito apunta
-- siempre a un producto. Por eso aquí se decide algo que después no se puede
-- cambiar sin migrar medio sistema: **cómo se guardan las cantidades**.
--
-- La decisión es que cada producto tiene una unidad BASE en la que se almacena
-- el stock, y cualquier otra unidad de la misma dimensión se convierte a ella
-- con un factor. Comprar una caja de 12 y vender unidades sueltas no puede
-- exigir que alguien recuerde multiplicar: si el factor no está en la base de
-- datos, el inventario se descuadra y nadie sabe cuándo empezó.

-- ── Unidades de medida ───────────────────────────────────────────────────────

CREATE TABLE uoms (
  id              uuid PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code            text        NOT NULL,
  name            text        NOT NULL,
  -- Solo se convierten entre sí las unidades de la MISMA dimensión. Sin esto,
  -- nada impediría "convertir" kilos a metros y obtener un número plausible.
  dimension       text        NOT NULL
                    CHECK (dimension IN ('UNIT','WEIGHT','VOLUME','LENGTH','AREA','TIME')),
  -- Cuántas unidades base vale una de ésta. La caja de 12 tiene factor 12.
  -- Seis decimales porque hay factores que no son enteros (libra = 0,453592 kg).
  factor          numeric(19,6) NOT NULL DEFAULT 1 CHECK (factor > 0),
  -- Decimales admitidos al capturar cantidades. Las unidades discretas van a 0:
  -- media pantalla no existe, y permitirlo genera inventarios imposibles.
  precision       smallint    NOT NULL DEFAULT 2 CHECK (precision BETWEEN 0 AND 6),
  -- Código de unidad UN/ECE rec. 20, obligatorio en la factura electrónica DIAN.
  dian_code       text,
  is_base         boolean     NOT NULL DEFAULT false,
  is_active       boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);
-- Una sola unidad base por dimensión: es el ancla de todas las conversiones.
CREATE UNIQUE INDEX uoms_one_base_per_dimension
  ON uoms (organization_id, dimension) WHERE is_base;
SELECT enable_tenant_rls('uoms');
SELECT attach_updated_at('uoms');

-- ── Categorías ───────────────────────────────────────────────────────────────

CREATE TABLE product_categories (
  id              uuid PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  parent_id       uuid        REFERENCES product_categories(id) ON DELETE RESTRICT,
  name            text        NOT NULL,
  -- Ruta materializada ("Bebidas / Gaseosas / Lata"). Redundante a propósito:
  -- permite ordenar el árbol, buscarlo por prefijo y mostrarlo sin recursión.
  -- Se recalcula al mover una rama, que es una operación rara.
  path            text        NOT NULL,
  depth           smallint    NOT NULL DEFAULT 0,
  description     text,
  -- Cuentas contables por defecto de la categoría: los productos las heredan si
  -- no tienen las suyas. Evita configurar 2.000 productos uno a uno.
  income_account_id    uuid,
  expense_account_id   uuid,
  inventory_account_id uuid,
  is_active       boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, path)
);
CREATE INDEX product_categories_parent ON product_categories (organization_id, parent_id);
SELECT enable_tenant_rls('product_categories');
SELECT attach_updated_at('product_categories');

-- ── Productos ────────────────────────────────────────────────────────────────

CREATE TABLE products (
  id              uuid PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sku             text        NOT NULL,
  barcode         text,
  name            text        NOT NULL,
  description     text,
  -- GOOD: se almacena y se cuenta. SERVICE: no tiene existencias (una hora de
  -- consultoría no se inventaría). KIT: se vende como uno y se despachan sus
  -- componentes.
  kind            text        NOT NULL DEFAULT 'GOOD' CHECK (kind IN ('GOOD','SERVICE','KIT')),
  category_id     uuid        REFERENCES product_categories(id) ON DELETE SET NULL,

  -- Unidad base del producto: en ésta se guarda SIEMPRE el stock.
  uom_id          uuid        NOT NULL REFERENCES uoms(id) ON DELETE RESTRICT,
  -- Unidades preferidas al vender y al comprar; deben ser de la misma dimensión.
  sale_uom_id     uuid        REFERENCES uoms(id) ON DELETE SET NULL,
  purchase_uom_id uuid        REFERENCES uoms(id) ON DELETE SET NULL,

  -- Precios de referencia. El precio real sale de la lista aplicable; éste es
  -- el que se usa cuando no hay ninguna.
  sale_price      numeric(19,4) NOT NULL DEFAULT 0 CHECK (sale_price >= 0),
  purchase_price  numeric(19,4) NOT NULL DEFAULT 0 CHECK (purchase_price >= 0),
  currency_code   char(3)     NOT NULL DEFAULT 'COP' REFERENCES currencies(code),
  -- Precio de venta con impuestos incluidos: el comercio al detal cotiza así.
  -- Guardarlo aquí evita que cada pantalla decida por su cuenta si el 19 % ya
  -- estaba dentro, que es de donde salen las diferencias de un peso.
  price_includes_tax boolean  NOT NULL DEFAULT false,

  sale_tax_id     uuid        REFERENCES taxes(id) ON DELETE SET NULL,
  purchase_tax_id uuid        REFERENCES taxes(id) ON DELETE SET NULL,

  -- Solo los bienes mueven existencias; el CHECK impide el estado imposible de
  -- un servicio con inventario, que rompería el costo de ventas.
  track_inventory boolean     NOT NULL DEFAULT true,
  cost_method     text        NOT NULL DEFAULT 'AVERAGE'
                    CHECK (cost_method IN ('AVERAGE','FIFO','STANDARD')),
  standard_cost   numeric(19,4) NOT NULL DEFAULT 0 CHECK (standard_cost >= 0),
  min_stock       numeric(19,4),
  max_stock       numeric(19,4),
  -- Lotes y series: exigido por ley para medicamentos y alimentos.
  tracking        text        NOT NULL DEFAULT 'NONE' CHECK (tracking IN ('NONE','LOT','SERIAL')),

  income_account_id    uuid,
  expense_account_id   uuid,
  inventory_account_id uuid,

  brand           text,
  manufacturer_sku text,
  weight_kg       numeric(19,6),
  is_sellable     boolean     NOT NULL DEFAULT true,
  is_purchasable  boolean     NOT NULL DEFAULT true,
  is_active       boolean     NOT NULL DEFAULT true,
  owner_membership_id uuid    REFERENCES memberships(id) ON DELETE SET NULL,
  created_by      uuid        REFERENCES memberships(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,

  CONSTRAINT products_service_has_no_stock
    CHECK (kind <> 'SERVICE' OR track_inventory = false),
  CONSTRAINT products_untracked_has_no_lots
    CHECK (track_inventory OR tracking = 'NONE')
);
CREATE UNIQUE INDEX products_sku ON products (organization_id, sku) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX products_barcode ON products (organization_id, barcode)
  WHERE barcode IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX products_name ON products (organization_id, name) WHERE deleted_at IS NULL;
CREATE INDEX products_category ON products (organization_id, category_id) WHERE deleted_at IS NULL;
SELECT enable_tenant_rls('products');
SELECT attach_updated_at('products');

-- ── Variantes ────────────────────────────────────────────────────────────────
--
-- Una camisa azul talla M no es un producto distinto de la misma camisa roja
-- talla L: comparten precio, impuestos y cuentas, y se diferencian en atributos
-- y existencias. Modelarlas como productos sueltos multiplica el catálogo por
-- diez y hace imposible preguntar "cuántas camisas tengo".

CREATE TABLE product_variants (
  id              uuid PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id      uuid        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku             text        NOT NULL,
  barcode         text,
  name            text        NOT NULL,
  -- {"talla": "M", "color": "azul"}. Documento porque los ejes varían por
  -- producto y una tabla de atributos daría tres saltos para pintar una línea.
  attributes      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- Diferencia sobre el precio del producto. Puede ser negativa (talla infantil).
  price_delta     numeric(19,4) NOT NULL DEFAULT 0,
  weight_kg       numeric(19,6),
  is_active       boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);
CREATE UNIQUE INDEX product_variants_sku ON product_variants (organization_id, sku)
  WHERE deleted_at IS NULL;
CREATE INDEX product_variants_product ON product_variants (organization_id, product_id)
  WHERE deleted_at IS NULL;
SELECT enable_tenant_rls('product_variants');
SELECT attach_updated_at('product_variants');

-- ── Componentes de un kit ────────────────────────────────────────────────────

CREATE TABLE product_components (
  organization_id uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  parent_id       uuid          NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  component_id    uuid          NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity        numeric(19,6) NOT NULL CHECK (quantity > 0),
  uom_id          uuid          NOT NULL REFERENCES uoms(id) ON DELETE RESTRICT,
  PRIMARY KEY (parent_id, component_id),
  -- Un kit que se contiene a sí mismo explotaría al despacharlo.
  CONSTRAINT product_components_not_self CHECK (parent_id <> component_id)
);
SELECT enable_tenant_rls('product_components');

-- ── Listas de precios ────────────────────────────────────────────────────────
--
-- Tres formas de fijar precio, porque las tres se usan a diario:
--   · FIXED    — precio explícito por producto (la lista mayorista).
--   · DERIVED  — un porcentaje sobre otra lista ("distribuidores: -15 % sobre
--                la general"). Cambiar la base actualiza la derivada sola.
--   · Escalas  — por cantidad mínima, dentro de cualquiera de las dos.

CREATE TABLE price_lists (
  id              uuid PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  kind            text        NOT NULL DEFAULT 'SALE' CHECK (kind IN ('SALE','PURCHASE')),
  currency_code   char(3)     NOT NULL DEFAULT 'COP' REFERENCES currencies(code),
  mode            text        NOT NULL DEFAULT 'FIXED' CHECK (mode IN ('FIXED','DERIVED')),
  based_on_id     uuid        REFERENCES price_lists(id) ON DELETE RESTRICT,
  -- Descuento de una lista derivada: 15 significa 15 % menos que la base.
  -- Negativo = recargo, que es como se modela la lista de precio público.
  adjustment_percent numeric(9,6) NOT NULL DEFAULT 0,
  -- Redondeo del resultado: 100 deja los precios en centenas exactas, que es lo
  -- normal en Colombia porque las monedas de menos de 50 pesos ya no circulan.
  rounding        numeric(19,4) NOT NULL DEFAULT 0 CHECK (rounding >= 0),
  includes_tax    boolean     NOT NULL DEFAULT false,
  valid_from      date,
  valid_to        date,
  is_default      boolean     NOT NULL DEFAULT false,
  is_active       boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name),
  CONSTRAINT price_lists_derived_has_base
    CHECK (mode <> 'DERIVED' OR based_on_id IS NOT NULL),
  CONSTRAINT price_lists_base_is_not_self CHECK (based_on_id IS NULL OR based_on_id <> id),
  CONSTRAINT price_lists_valid_range CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);
-- Una sola lista por defecto para cada uso (venta / compra).
CREATE UNIQUE INDEX price_lists_one_default ON price_lists (organization_id, kind) WHERE is_default;
SELECT enable_tenant_rls('price_lists');
SELECT attach_updated_at('price_lists');

CREATE TABLE price_list_items (
  id              uuid PRIMARY KEY,
  organization_id uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  price_list_id   uuid          NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE,
  product_id      uuid          NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id      uuid          REFERENCES product_variants(id) ON DELETE CASCADE,
  -- Escala: este precio rige a partir de esta cantidad. 1 es el precio normal.
  min_quantity    numeric(19,6) NOT NULL DEFAULT 1 CHECK (min_quantity > 0),
  price           numeric(19,4) NOT NULL CHECK (price >= 0),
  created_at      timestamptz   NOT NULL DEFAULT now(),
  updated_at      timestamptz   NOT NULL DEFAULT now()
);
-- Un solo precio por escala. `coalesce` porque en PostgreSQL dos NULL no chocan,
-- y sin esto el producto sin variante admitiría filas duplicadas.
CREATE UNIQUE INDEX price_list_items_unique
  ON price_list_items (price_list_id, product_id, coalesce(variant_id, product_id), min_quantity);
CREATE INDEX price_list_items_product ON price_list_items (organization_id, product_id);
SELECT enable_tenant_rls('price_list_items');
SELECT attach_updated_at('price_list_items');

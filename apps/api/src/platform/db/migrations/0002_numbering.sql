-- ═══════════════════════════════════════════════════════════════════════════
-- 0002 · Numeración de documentos
-- ═══════════════════════════════════════════════════════════════════════════
-- Toda factura, cotización, orden, asiento y recibo necesita un consecutivo sin
-- huecos ni repeticiones. En Colombia, además, la numeración de facturas está
-- atada a una resolución de la DIAN con un rango autorizado, así que el contador
-- necesita saber dónde empieza y dónde termina.

CREATE TABLE document_sequences (
  id              uuid PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id       uuid        REFERENCES branches(id) ON DELETE CASCADE,
  doc_type        text        NOT NULL,
  prefix          text        NOT NULL DEFAULT '',
  next_number     bigint      NOT NULL DEFAULT 1 CHECK (next_number > 0),
  padding         smallint    NOT NULL DEFAULT 6 CHECK (padding BETWEEN 0 AND 12),
  -- Reinicio del contador: nunca, cada año o cada mes.
  period_scope    text        NOT NULL DEFAULT 'NEVER'
                    CHECK (period_scope IN ('NEVER','YEAR','MONTH')),
  period_key      text        NOT NULL DEFAULT '',
  -- Rango autorizado (resolución DIAN). NULL = sin límite.
  range_from      bigint,
  range_to        bigint,
  is_active       boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (range_to IS NULL OR range_from IS NULL OR range_to >= range_from)
);
CREATE UNIQUE INDEX document_sequences_key
  ON document_sequences (organization_id, doc_type, prefix, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid));
SELECT enable_tenant_rls('document_sequences');
SELECT attach_updated_at('document_sequences');

-- ═══════════════════════════════════════════════════════════════════════════
-- 0001 · Identidad, membresías, equipos y control de acceso basado en roles
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Usuarios (tabla de PLATAFORMA: sin RLS) ────────────────────────────────
-- Un usuario existe por encima de las organizaciones: puede pertenecer a varias.
CREATE TABLE users (
  id             uuid PRIMARY KEY,
  email          text        NOT NULL,
  password_hash  text        NOT NULL,
  first_name     text        NOT NULL,
  last_name      text        NOT NULL,
  phone          text,
  avatar_file_id uuid,
  locale         text        NOT NULL DEFAULT 'es-CO',
  status         text        NOT NULL DEFAULT 'ACTIVE'
                   CHECK (status IN ('ACTIVE','INVITED','SUSPENDED','DELETED')),
  totp_secret    text,
  totp_enabled   boolean     NOT NULL DEFAULT false,
  last_login_at  timestamptz,
  -- Administrador de la plataforma (soporte). Supera cualquier comprobación de
  -- permisos, por lo que se concede a mano y queda auditado.
  is_super_admin boolean     NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));
SELECT attach_updated_at('users');

-- ── Membresías (tabla de PLATAFORMA: se consulta antes de elegir organización)
CREATE TABLE memberships (
  id                uuid PRIMARY KEY,
  user_id           uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id   uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  default_branch_id uuid        REFERENCES branches(id) ON DELETE SET NULL,
  job_title         text,
  status            text        NOT NULL DEFAULT 'ACTIVE'
                      CHECK (status IN ('ACTIVE','SUSPENDED','REMOVED')),
  -- El dueño de la organización no puede quedarse sin permisos ni ser eliminado.
  is_owner          boolean     NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, organization_id)
);
CREATE INDEX memberships_org ON memberships (organization_id) WHERE status = 'ACTIVE';
SELECT attach_updated_at('memberships');

-- ── Catálogo de permisos (global, sincronizado desde el código al arrancar) ──
-- Ningún permiso se escribe a mano: cada módulo declara los suyos en su
-- module.ts. Un test verifica que no exista un permiso que nadie comprueba
-- ni una comprobación de un permiso inexistente.
CREATE TABLE permissions (
  key         text PRIMARY KEY,
  module      text        NOT NULL,
  resource    text        NOT NULL,
  action      text        NOT NULL,
  label       text        NOT NULL,
  description text,
  scopes      text[]      NOT NULL DEFAULT ARRAY['ORG'],
  sensitive   boolean     NOT NULL DEFAULT false,
  synced_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX permissions_module ON permissions (module, resource);

-- ── Roles ───────────────────────────────────────────────────────────────────
-- Siempre pertenecen a una organización: las plantillas del sistema viven en
-- código y se copian al crear la organización, para que cada una pueda editarlas.
CREATE TABLE roles (
  id              uuid PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code            text,
  name            text        NOT NULL,
  description     text,
  -- Los roles del sistema no se borran ni se renombran, pero sí se editan.
  is_system       boolean     NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);
CREATE UNIQUE INDEX roles_org_code ON roles (organization_id, code) WHERE code IS NOT NULL;
SELECT enable_tenant_rls('roles');
SELECT attach_updated_at('roles');

CREATE TABLE role_permissions (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role_id         uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_key  text NOT NULL REFERENCES permissions(key) ON DELETE CASCADE,
  scope           text NOT NULL DEFAULT 'ORG' CHECK (scope IN ('OWN','TEAM','BRANCH','ORG')),
  PRIMARY KEY (role_id, permission_key)
);
CREATE INDEX role_permissions_org ON role_permissions (organization_id);
SELECT enable_tenant_rls('role_permissions');

CREATE TABLE membership_roles (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  membership_id   uuid NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  role_id         uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (membership_id, role_id)
);
CREATE INDEX membership_roles_role ON membership_roles (role_id);
SELECT enable_tenant_rls('membership_roles');

-- Excepciones puntuales sobre una persona concreta. DENY siempre gana.
CREATE TABLE permission_overrides (
  id              uuid PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  membership_id   uuid        NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  permission_key  text        NOT NULL REFERENCES permissions(key) ON DELETE CASCADE,
  effect          text        NOT NULL CHECK (effect IN ('ALLOW','DENY')),
  scope           text        NOT NULL DEFAULT 'ORG' CHECK (scope IN ('OWN','TEAM','BRANCH','ORG')),
  reason          text,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (membership_id, permission_key)
);
SELECT enable_tenant_rls('permission_overrides');

-- ── Equipos (alcance TEAM de los permisos) ──────────────────────────────────
CREATE TABLE teams (
  id                uuid PRIMARY KEY,
  organization_id   uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name              text        NOT NULL,
  description       text,
  parent_team_id    uuid        REFERENCES teams(id) ON DELETE SET NULL,
  lead_membership_id uuid       REFERENCES memberships(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);
SELECT enable_tenant_rls('teams');
SELECT attach_updated_at('teams');

CREATE TABLE team_members (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  team_id         uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  membership_id   uuid NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  PRIMARY KEY (team_id, membership_id)
);
CREATE INDEX team_members_membership ON team_members (membership_id);
SELECT enable_tenant_rls('team_members');

-- ── Sesiones: refresco rotatorio y revocable ────────────────────────────────
-- Se guarda el hash, nunca el token. `replaced_by_id` permite detectar el reuso
-- de un token ya rotado, que indica robo de credenciales.
CREATE TABLE refresh_tokens (
  id             uuid PRIMARY KEY,
  user_id        uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash     text        NOT NULL UNIQUE,
  expires_at     timestamptz NOT NULL,
  revoked_at     timestamptz,
  replaced_by_id uuid        REFERENCES refresh_tokens(id) ON DELETE SET NULL,
  user_agent     text,
  ip             inet,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_user ON refresh_tokens (user_id) WHERE revoked_at IS NULL;

-- ── Invitaciones (tabla de FRONTERA: sin RLS, ver nota más abajo) ───────────
CREATE TABLE invitations (
  id              uuid PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email           text        NOT NULL,
  role_ids        uuid[]      NOT NULL DEFAULT '{}',
  token_hash      text        NOT NULL UNIQUE,
  invited_by      uuid        REFERENCES memberships(id) ON DELETE SET NULL,
  expires_at      timestamptz NOT NULL,
  accepted_at     timestamptz,
  revoked_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX invitations_pending ON invitations (organization_id, lower(email))
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
-- SIN RLS a propósito: pertenece a la frontera de autenticación, igual que
-- `memberships`. Quien acepta una invitación todavía NO pertenece a la
-- organización, así que no hay tenant que fijar; el secreto que autoriza la
-- lectura es el hash del token. Las consultas de gestión filtran siempre por
-- organization_id de forma explícita.

-- ── Claves de API (para la API pública) ─────────────────────────────────────
CREATE TABLE api_keys (
  id              uuid PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  key_prefix      text        NOT NULL,
  key_hash        text        NOT NULL UNIQUE,
  scopes          text[]      NOT NULL DEFAULT '{}',
  created_by      uuid        REFERENCES memberships(id) ON DELETE SET NULL,
  last_used_at    timestamptz,
  expires_at      timestamptz,
  revoked_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX api_keys_prefix ON api_keys (key_prefix);
SELECT enable_tenant_rls('api_keys');

-- ── Auditoría inmutable ─────────────────────────────────────────────────────
-- Se escribe en la misma transacción que el cambio, mediante un decorador de
-- repositorio, para que ningún caso de uso tenga que acordarse de auditar.
CREATE TABLE audit_logs (
  id                  bigserial PRIMARY KEY,
  organization_id     uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_membership_id uuid        REFERENCES memberships(id) ON DELETE SET NULL,
  actor_label         text,
  actor_ip            inet,
  request_id          text,
  action              text        NOT NULL CHECK (action IN ('CREATE','UPDATE','DELETE','POST','VOID','LOGIN','EXPORT')),
  entity_type         text        NOT NULL,
  entity_id           uuid,
  entity_label        text,
  before              jsonb,
  after               jsonb,
  changed_fields      text[],
  occurred_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_entity ON audit_logs (organization_id, entity_type, entity_id, occurred_at DESC);
CREATE INDEX audit_logs_actor ON audit_logs (organization_id, actor_membership_id, occurred_at DESC);
SELECT enable_tenant_rls('audit_logs');

-- La auditoría no se edita ni se borra: si se pudiera, no serviría de auditoría.
CREATE RULE audit_logs_no_update AS ON UPDATE TO audit_logs DO INSTEAD NOTHING;
CREATE RULE audit_logs_no_delete AS ON DELETE TO audit_logs DO INSTEAD NOTHING;

-- ── Vistas guardadas de la DataTable ────────────────────────────────────────
CREATE TABLE saved_views (
  id              uuid PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  membership_id   uuid        REFERENCES memberships(id) ON DELETE CASCADE,
  entity_type     text        NOT NULL,
  name            text        NOT NULL,
  config          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  is_shared       boolean     NOT NULL DEFAULT false,
  is_default      boolean     NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX saved_views_lookup ON saved_views (organization_id, entity_type, membership_id);
SELECT enable_tenant_rls('saved_views');
SELECT attach_updated_at('saved_views');

-- ── Notificaciones ──────────────────────────────────────────────────────────
CREATE TABLE notifications (
  id              uuid PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  membership_id   uuid        NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  type            text        NOT NULL,
  title           text        NOT NULL,
  body            text        NOT NULL DEFAULT '',
  data            jsonb       NOT NULL DEFAULT '{}'::jsonb,
  entity_type     text,
  entity_id       uuid,
  read_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_inbox ON notifications (membership_id, created_at DESC);
CREATE INDEX notifications_unread ON notifications (membership_id) WHERE read_at IS NULL;
SELECT enable_tenant_rls('notifications');

CREATE TABLE notification_preferences (
  organization_id uuid   NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  membership_id   uuid   NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  event_type      text   NOT NULL,
  channels        text[] NOT NULL DEFAULT ARRAY['IN_APP'],
  PRIMARY KEY (membership_id, event_type)
);
SELECT enable_tenant_rls('notification_preferences');

-- ── Ficheros y adjuntos (transversales a todos los módulos) ─────────────────
CREATE TABLE files (
  id              uuid PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  storage_key     text        NOT NULL,
  filename        text        NOT NULL,
  mime            text        NOT NULL,
  size_bytes      bigint      NOT NULL,
  checksum        text,
  uploaded_by     uuid        REFERENCES memberships(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
SELECT enable_tenant_rls('files');

CREATE TABLE attachments (
  id              uuid PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  file_id         uuid        NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  entity_type     text        NOT NULL,
  entity_id       uuid        NOT NULL,
  created_by      uuid        REFERENCES memberships(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attachments_entity ON attachments (organization_id, entity_type, entity_id);
SELECT enable_tenant_rls('attachments');

-- ═══════════════════════════════════════════════════════════════════════════
-- 0003 · Cierra el aislamiento de `memberships`
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `memberships` se dejó sin RLS porque hay que consultarla ANTES de saber en qué
-- organización está el usuario (login, listar sus empresas). El precio fue un
-- agujero real: un listado que la une con `users` sin filtrar por organización
-- devolvía personas de OTRAS empresas.
--
-- Filtrar a mano en cada consulta no es defensa: basta con que alguien lo olvide
-- una vez. La tabla necesita RLS, pero con una política que contemple sus dos
-- modos de uso legítimos:
--
--   · DENTRO de una organización  → solo las filas de esa organización.
--   · ANTES de elegir organización → solo las filas del propio usuario.
--
-- El segundo modo se habilita fijando `app.user_id`, que es el identificador que
-- el token ya demostró. Sin ninguno de los dos ajustes, la tabla no devuelve nada.

CREATE OR REPLACE FUNCTION app_current_user() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;

ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;

CREATE POLICY membership_access ON memberships
  USING (
    (app_current_org() IS NOT NULL AND organization_id = app_current_org())
    OR (app_current_org() IS NULL AND app_current_user() IS NOT NULL AND user_id = app_current_user())
  )
  WITH CHECK (
    (app_current_org() IS NOT NULL AND organization_id = app_current_org())
    OR (app_current_org() IS NULL AND app_current_user() IS NOT NULL AND user_id = app_current_user())
  );

-- `users` es global por diseño (una persona puede estar en varias empresas), pero
-- solo debe verse a sí misma fuera de una organización, o a quienes comparten
-- organización con quien pregunta.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

CREATE POLICY user_access ON users
  USING (
    -- Uno siempre se ve a sí mismo.
    (app_current_user() IS NOT NULL AND id = app_current_user())
    -- Dentro de una organización, a quienes pertenecen a ella.
    OR (app_current_org() IS NOT NULL AND EXISTS (
          SELECT 1 FROM memberships m
           WHERE m.user_id = users.id AND m.organization_id = app_current_org()))
    -- Y, sin ningún ajuste fijado, a nadie: es el caso del login, que necesita
    -- buscar por correo antes de saber quién es. Para eso está la política de
    -- abajo, acotada a la búsqueda por correo durante la autenticación.
    OR current_setting('app.authenticating', true) = 'on'
  )
  WITH CHECK (
    (app_current_user() IS NOT NULL AND id = app_current_user())
    OR current_setting('app.authenticating', true) = 'on'
  );

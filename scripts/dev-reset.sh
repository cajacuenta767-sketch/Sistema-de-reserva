#!/usr/bin/env bash
# Reinicia la base de datos y la API en desarrollo.
#
# El orden importa: el catálogo de permisos se sincroniza AL ARRANCAR la API.
# Si se vacía la base con la API en marcha, las plantillas de rol intentan
# conceder permisos que ya no existen en la tabla y el registro falla con un
# error de clave foránea que no dice nada útil.
set -euo pipefail
cd "$(dirname "$0")/.."

pg_isready >/dev/null 2>&1 || pg_ctlcluster 16 main start

# .env está en .gitignore, así que en una copia limpia del repo no existe.
[ -f apps/api/.env ] || cp .env.example apps/api/.env

if [ -f /tmp/claude-0/api.pid ]; then kill "$(cat /tmp/claude-0/api.pid)" 2>/dev/null || true; fi
sleep 1

(cd apps/api && pnpm exec tsx src/platform/db/reset.cli.ts)

cd apps/api
nohup pnpm exec tsx src/bootstrap/main.ts > /tmp/claude-0/api.log 2>&1 &
echo $! > /tmp/claude-0/api.pid

for _ in $(seq 1 30); do
  if curl -sf localhost:4000/api/v1/health >/dev/null; then
    echo "API lista: $(curl -s localhost:4000/api/v1/health)"
    exit 0
  fi
  sleep 1
done
echo "La API no arrancó; revisa /tmp/claude-0/api.log" >&2
exit 1

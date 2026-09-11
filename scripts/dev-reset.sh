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

# Se mata por PUERTO, no por PID ni por patrón de línea de comandos.
#
# `nohup pnpm exec tsx ... &` deja en `$!` el PID de pnpm, no el del node que
# realmente escucha: matarlo dejaba vivo al servidor viejo, que seguía
# respondiendo en el 4000 mientras el nuevo arrancaba al lado. El resultado era
# una API que decía tener los módulos de hace dos horas y nada explicaba por qué.
# Por patrón tampoco: `pkill -f tsx` casa también con el shell que lo ejecuta.
free_port() {
  local port=$1
  fuser -k "$port/tcp" >/dev/null 2>&1 || true
  for _ in $(seq 1 10); do
    fuser "$port/tcp" >/dev/null 2>&1 || return 0
    sleep 0.5
  done
  echo "El puerto $port sigue ocupado" >&2
  return 1
}

free_port 4000

(cd apps/api && pnpm exec tsx src/platform/db/reset.cli.ts)

cd apps/api
nohup pnpm exec tsx src/bootstrap/main.ts > /tmp/claude-0/api.log 2>&1 &

for _ in $(seq 1 30); do
  if curl -sf localhost:4000/api/v1/health >/dev/null; then
    echo "API lista: $(curl -s localhost:4000/api/v1/health)"
    exit 0
  fi
  sleep 1
done
echo "La API no arrancó; revisa /tmp/claude-0/api.log" >&2
exit 1

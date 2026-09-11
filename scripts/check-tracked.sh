#!/usr/bin/env bash
#
# Comprueba que no haya código fuente fuera del repositorio.
#
# Una regla de `.gitignore` sin anclar puede excluir código sin que nadie se
# entere: `storage/` casaba con `src/platform/storage/`, así que `FileStorage.ts`
# nunca se subió y CI estuvo en rojo varias fases con un "Cannot find module"
# que en local no se reproducía, porque en local el fichero sí estaba.
#
# La comprobación es barata y el fallo que evita es caro de diagnosticar.
set -euo pipefail
cd "$(dirname "$0")/.."

DIRS=(apps/api/src apps/web/src packages/core/src packages/contracts/src
      apps/api/tests apps/web/tests packages/core/tests packages/contracts/tests
      scripts docs)

faltan=()
for dir in "${DIRS[@]}"; do
  [ -d "$dir" ] || continue
  while IFS= read -r file; do
    git ls-files --error-unmatch "$file" >/dev/null 2>&1 || faltan+=("$file")
  done < <(find "$dir" -type f \
    \( -name '*.ts' -o -name '*.tsx' -o -name '*.sql' -o -name '*.css' \
       -o -name '*.mjs' -o -name '*.sh' -o -name '*.md' \) ! -path '*/node_modules/*')
done

if [ ${#faltan[@]} -gt 0 ]; then
  echo "❌ Hay código fuente que NO está en el repositorio:" >&2
  printf '   %s\n' "${faltan[@]}" >&2
  echo >&2
  echo "   Casi siempre es una regla de .gitignore sin anclar. Comprueba con:" >&2
  echo "     git check-ignore -v <fichero>" >&2
  exit 1
fi

echo "✅ Todo el código fuente está en el repositorio."

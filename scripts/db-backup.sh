#!/usr/bin/env bash
# Respaldo lógico de PostgreSQL (ADR 0070, ADR 0189). Uso: DATABASE_URL=… scripts/db-backup.sh [directorio]
# Formato custom (-Fc): comprimido y restaurable por tablas.
# Cifrado con clave pública (age): BACKUP_AGE_RECIPIENTS="age1… age1…". El volcado va directo a age: nunca queda en
# claro en disco, y el servidor que respalda no guarda la clave privada (solo la tiene quien restaura).
# En producción (NODE_ENV=production) o con BACKUP_REQUIRE_ENCRYPTION=1, sin destinatarios no se respalda.
# Retención: con BACKUP_KEEP_LAST (y opcional BACKUP_KEEP_WEEKS) se borran los respaldos viejos de ESE directorio.
set -euo pipefail
: "${DATABASE_URL:?Falta DATABASE_URL}"
dir="${1:-./backups}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
require="${BACKUP_REQUIRE_ENCRYPTION:-$([ "${NODE_ENV:-}" = production ] && echo 1 || echo 0)}"
recipients="${BACKUP_AGE_RECIPIENTS:-}"
mkdir -p "$dir"
out="$dir/dizaster-$(date -u +%Y%m%dT%H%M%SZ).dump"

if [ -n "$recipients" ]; then
  command -v age >/dev/null || { echo "Falta 'age' (https://age-encryption.org)" >&2; exit 2; }
  args=()
  for r in ${recipients//,/ }; do
    [[ "$r" == age1* ]] || { echo "Destinatario age inválido: $r" >&2; exit 2; }
    args+=(-r "$r")
  done
  out="$out.age"
  trap 'rm -f "$out.partial"' EXIT
  pg_dump --format=custom --no-owner --no-privileges "$DATABASE_URL" | age "${args[@]}" -o "$out.partial"
  mv "$out.partial" "$out"
elif [ "$require" = 1 ]; then
  echo "Sin BACKUP_AGE_RECIPIENTS: en producción los respaldos van cifrados. No se respalda." >&2
  exit 3
else
  echo "Aviso: respaldo SIN cifrar (solo desarrollo). Define BACKUP_AGE_RECIPIENTS." >&2
  pg_dump --format=custom --no-owner --no-privileges --file="$out" "$DATABASE_URL"
fi
( cd "$dir" && sha256sum "$(basename "$out")" > "$(basename "$out").sha256" )

if [ -n "${BACKUP_KEEP_LAST:-}" ]; then
  node "$here/backup-retention.mjs" "$dir" >&2
fi
echo "$out"

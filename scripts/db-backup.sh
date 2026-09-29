#!/usr/bin/env bash
# Respaldo lógico de PostgreSQL (ADR 0070). Uso: DATABASE_URL=… scripts/db-backup.sh [directorio]
# Formato custom (-Fc): comprimido y restaurable por tablas. Cifrar y subir a otro proveedor es paso del operador.
set -euo pipefail
: "${DATABASE_URL:?Falta DATABASE_URL}"
dir="${1:-./backups}"
mkdir -p "$dir"
out="$dir/dizaster-$(date -u +%Y%m%dT%H%M%SZ).dump"
pg_dump --format=custom --no-owner --no-privileges --file="$out" "$DATABASE_URL"
sha256sum "$out" > "$out.sha256"
echo "$out"

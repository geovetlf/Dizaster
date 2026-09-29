#!/usr/bin/env bash
# Sube teselas, estilos y recursos al object storage (S3 compatible). BLOQUEADO hasta aprobar proveedor y bucket.
# Por defecto solo muestra lo que haría; con --apply sube de verdad.
# Variables: MAPS_BUCKET (s3://bucket/maps), S3_ENDPOINT, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY.
set -euo pipefail
cd "$(dirname "$0")/../.."

APPLY=0; [ "${1:-}" = "--apply" ] && APPLY=1
: "${MAPS_BUCKET:?Falta MAPS_BUCKET (p. ej. s3://dizaster-public/maps)}"
: "${S3_ENDPOINT:?Falta S3_ENDPOINT}"
OUT="infra/maps/out"
[ -d "$OUT" ] || { echo "No hay nada en $OUT: ejecuta build-region.sh y make-style.mjs antes." >&2; exit 2; }

run() { if [ "$APPLY" = 1 ]; then "$@"; else echo "(simulación) $*"; fi; }
# Las teselas cambian poco: caché larga. Los estilos, corta, para poder cambiar de proveedor rápido.
for f in "$OUT"/*.pmtiles; do run aws s3 cp "$f" "$MAPS_BUCKET/" --endpoint-url "$S3_ENDPOINT" --cache-control "public, max-age=604800"; done
for f in "$OUT"/style-*.json; do run aws s3 cp "$f" "$MAPS_BUCKET/" --endpoint-url "$S3_ENDPOINT" --content-type application/json --cache-control "public, max-age=300"; done
[ -d "$OUT/assets" ] && run aws s3 sync "$OUT/assets" "$MAPS_BUCKET/assets" --endpoint-url "$S3_ENDPOINT" --cache-control "public, max-age=604800"
echo "Listo. Configura MAP_STYLE_URL_LIGHT/DARK con las URLs públicas de style-light.json y style-dark.json."

#!/usr/bin/env bash
# Extrae las teselas OSM de un país desde un build planetario público de Protomaps (sin generar nada nosotros).
# Requiere el binario `pmtiles` (https://github.com/protomaps/go-pmtiles). Solo descarga las teselas del país.
# Uso: infra/maps/build-region.sh PE [maxzoom=15] [build=AAAAMMDD]
set -euo pipefail
cd "$(dirname "$0")/../.."

ISO2="${1:?Uso: build-region.sh <ISO2> [maxzoom] [build]}"
MAXZOOM="${2:-15}"
BUILD="${3:-$(date -u -d 'yesterday' +%Y%m%d)}"
PLANET="https://build.protomaps.com/${BUILD}.pmtiles"
OUT="infra/maps/out"
mkdir -p "$OUT"

command -v pmtiles >/dev/null || { echo "Falta el binario pmtiles (go-pmtiles)." >&2; exit 2; }
BBOX="$(node infra/maps/country-bbox.mjs "$ISO2")"
LOWER="$(echo "$ISO2" | tr '[:upper:]' '[:lower:]')"

echo "Extrayendo $ISO2 ($BBOX) hasta z$MAXZOOM desde $PLANET"
pmtiles extract "$PLANET" "$OUT/$LOWER.pmtiles" --bbox="$BBOX" --maxzoom="$MAXZOOM"
pmtiles show "$OUT/$LOWER.pmtiles"

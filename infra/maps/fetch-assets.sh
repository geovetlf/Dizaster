#!/usr/bin/env bash
# Descarga fuentes (glyphs) y sprites de Protomaps (licencias abiertas: OFL/CC0) a infra/maps/out/assets.
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT="infra/maps/out/assets"
TMP="$(mktemp -d)"
curl -fsSL https://github.com/protomaps/basemaps-assets/archive/refs/heads/main.tar.gz | tar -xz -C "$TMP"
mkdir -p "$OUT"
cp -r "$TMP"/basemaps-assets-main/fonts "$TMP"/basemaps-assets-main/sprites "$OUT"/
rm -rf "$TMP"
echo "Recursos en $OUT"

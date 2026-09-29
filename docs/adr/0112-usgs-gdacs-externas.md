# ADR 0112 — USGS y GDACS pasan a fuentes externas

Estado: aceptada (2026-09-29). Decisión del propietario (opción "Externas").

## Contexto
Tras D-PTWC-2 (ADR 0109), solo confirma oficialmente una institución registrada y autorizada para una categoría y
jurisdicción. USGS (sismos) y GDACS (varias categorías) seguían como OFICIALES con alcance mundial.

## Decisión
- `usgs-earthquakes` y `gdacs` pasan a `type`/`trustTier` EXTERNAL (registro `sources-2026.09.8`). Corroboran
  (EXTERNALLY_CORROBORATED), pueden promover a URGENT y aparecen como fuente del evento, pero nunca producen
  OFFICIALLY_CONFIRMED ni desmienten a FALSE.
- Fuentes oficiales vigentes para Perú: IGP, INDECI y SENAMHI (en RESEARCH hasta validar formato y términos) y los
  perfiles institucionales con ámbito asignado por administración (ADR 0095).
- En las pruebas, `actAsOfficial(t, "usgs-earthquakes")` marca USGS como oficial solo en la base de pruebas, para
  seguir probando la ruta OFFICIAL con muestras reales.

## Consecuencias
- Hasta que se active una fuente oficial peruana, ningún evento de Perú llega a OFFICIALLY_CONFIRMED por ingestión.

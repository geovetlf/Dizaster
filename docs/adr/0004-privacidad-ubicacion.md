# ADR 0004 — Privacidad de ubicación y publicación seudónima

- Estado: Aceptado · Fecha: 2026-09-29 · Blueprint §8.5, §13.2

## Decisión
- El fix GNSS del dispositivo vive solo en `report.presence_evidence` (privado del sistema). Retención 30 días (`PRESENCE_RETENTION_DAYS`); después `generalizeExpiredPresence` borra el fix y conserva solo la celda H3 r7.
- La API pública de eventos usa exclusivamente `public_geom`: centro de celda H3 según sensibilidad de la categoría — NORMAL r10 (celda de ~76 m de lado), SENSITIVE r8 (~0,7 km²), HIGHLY_SENSITIVE r7 (~5 km²). Nunca la coordenada original.
- La timeline pública no incluye identidades de reportantes.
- `anonymityMode = PSEUDONYMOUS` oculta la autoría pública; las categorías con `forcePseudonymous` (robo, violencia, personas desaparecidas) lo imponen.
- La generalización depende hoy de la categoría. El "riesgo y contexto" adicional pedido se añadirá como reglas sobre la misma función `generalize` (p. ej. subir un nivel de celda en zonas residenciales o para eventos con un solo reportante).

# ADR 0123 — Ventana de tiempo del mapa

Estado: aceptada (2026-09-29)

## Contexto
§6.3 prevé `/v1/events?…&since=`. El mapa mostraba todo lo vigente (ACTIVE, MONITORING y RESOLVED no archivado) sin
poder limitarse a lo reciente, que es lo que se busca en una emergencia.

## Decisión
- Parámetro `window` en `/v1/events` y en `/v1/events/tiles/:z/:x/:y` con valores fijos `6h`, `24h` y `7d`
  (`MapWindow` en contratos): eventos con actividad (`last_activity_at`) dentro de la ventana. Se usan ventanas
  fijas en lugar de una fecha libre porque la misma tesela debe tener la misma URL para todos y así la CDN la
  comparte (ADR 0078). El servidor además acota las horas y no concatena texto del cliente.
- App: un chip en el mapa que recorre "Cualquier fecha → Últimas 24 h → Últimas 6 h → Últimos 7 días". Como los
  demás filtros, la vista filtrada no reemplaza la copia offline sin filtros (ADR 0066). NO AI REQUIRED; costo 0.

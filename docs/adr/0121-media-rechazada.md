# ADR 0121 — Consumidores de MediaRejected

Estado: aceptada (2026-09-29)

## Contexto
§6.2: `MediaRejected` debe llegar a Report, Social y Moderación. Un reporte se puede enviar con media aún en proceso
(`UPLOADED`/`PROCESSING`) y la bonificación de presencia "capturada en la app" (presence-2, ADR 0073) se concedía
sin esperar al resultado. Si el Media Engine rechazaba después la foto (hash distinto, tipo falso, archivo dañado),
el reporte conservaba la bonificación, la línea de tiempo decía "fotos añadidas" y el post la mostraba "en proceso".

## Decisión
- geo-kit: `scoreFromBreakdown` (una sola fórmula con los topes de radio, atestación y testimonio tardío, usada
  también por `computePresence`), `PRESENCE_RULES_BY_VERSION` y `withoutMediaBonus`: recalcula desde los factores
  guardados sin la bonificación, con las reglas de la versión con que se puntuó. Solo baja.
- Report (migración 0052: `report.reports.media_ids`, con relleno): al rechazarse una media, cada reporte que la
  adjuntó y tenía bonificación baja su puntuación y banda, guarda el desglose revisado y el motivo `MEDIA_REJECTED`,
  y actualiza su evidencia en el evento (`EventService.revisePresence`: peso, banda, agregados y `EventEvidenceAdded`
  para que la verificación se reevalúe).
- Event: quita la media de las entradas `MEDIA_ADDED` (y borra la entrada si queda vacía).
- Social: suelta la media del post (`social.post_media`) para que no quede "en proceso" para siempre.
- Moderación no necesita consumidor: la media rechazada nunca llega a mostrarse.
- La bonificación se retira entera aunque el reporte tuviera otra foto válida (conservador; es 0,1 de peso).
  NO AI REQUIRED; costo 0.

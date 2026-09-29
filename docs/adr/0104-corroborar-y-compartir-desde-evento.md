# ADR 0104 — "Yo también lo veo" y compartir desde la ficha del evento

Estado: aceptada (2026-09-29)

## Contexto
§8.4 del Blueprint pide que corroborar un evento sea un gesto directo desde su ficha, y el Anexo A.7 que un evento
se pueda compartir. El formulario de reporte ya acepta `eventId` + `category` (corroboración, ADR previas) y las
publicaciones ya se comparten con enlaces `/e/` y `/p/` (ADR 0083).

## Decisión
- La ficha del evento muestra el chip **"Yo también lo veo"** solo si el evento está ACTIVE o MONITORING; abre
  `/report` con `eventId` y `category`. Las reglas de corroboración, presencia y antiabuso siguen en el servidor.
- Chip **Compartir**: hoja nativa (`Share.share`) con título + enlace. `shareUrl(kind, id, domain)` genera
  `https://<LINK_DOMAIN>/e|p/<id>` o `dizaster://event|post/<id>` si no hay dominio configurado; lo reutilizan
  publicaciones y eventos. NO AI REQUIRED.

## Consecuencias
- Sin endpoints nuevos ni coste. El enlace generado vuelve a la app mediante `rewriteSharedLinkPath` (probado).

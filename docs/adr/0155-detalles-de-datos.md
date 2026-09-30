# ADR 0155 — Detalles del modelo de datos: ítems externos en ERROR, compartidos externos, seguidores al dividir

- Estado: aceptada (2026-09-29) · AI_REQUIRED: no · COST: ninguno

## Contexto

Tres huecos entre §7.3 y el código:
1. `ExternalItem.status` admite ERROR, pero nada lo escribía: un ítem que fallaba por sí mismo tumbaba la corrida
   entera y los demás ítems del documento se perdían hasta la siguiente.
2. `Share.target = EXTERNAL` no se registraba: compartir fuera de la app no dejaba rastro ni contaba para el alcance.
3. Al dividir un evento (ADR 0034) quien lo seguía no seguía el nuevo, aunque fuera parte de lo que seguía.

## Decisión

1. Migración 0070: `external_items.error`. `IngestionScheduler` envuelve cada ítem: un `DomainError` deja el ítem
   en ERROR con código y motivo (secretos redactados) y la corrida sigue (`itemsFailed`). Un fallo que no es del ítem
   (base de datos, red) sigue abortando. Un ítem en ERROR se reintenta cuando vuelve a llegar, aunque no cambie.
2. `social.external_shares` (una fila por persona y post, sobre el original si es un compartido) y
   `posts.external_share_count`. `POST /v1/posts/:id/external-shares` (con sesión, 204, idempotente). No guarda a
   dónde ni con quién. Suma al alcance que usa la prioridad de moderación; se exporta con los datos de la persona y
   se borra al eliminar la cuenta. La app lo registra solo si el sistema confirma que se compartió.
3. `EventSplit` → quien seguía el original sigue también el nuevo (puede dejar de seguirlo).

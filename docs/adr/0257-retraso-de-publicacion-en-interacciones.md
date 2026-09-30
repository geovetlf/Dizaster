# ADR 0257 — El retraso de publicación también cubre interacciones y menciones

Fecha: 2026-09-30 · Estado: aceptada · NO AI REQUIRED

## Contexto
El retraso de publicación de las categorías HIGHLY_SENSITIVE (ADR 0099, 5 minutos para `crime.violence` según ADR 0109)
solo se aplicaba en el feed. Con el id del post se podía leer y escribir comentarios, reaccionar, compartir y registrar
compartidos externos antes de la hora. Además, la persona mencionada en el texto recibía el aviso de mención al instante,
con enlace al post (§8.5). Los contadores de posts de perfiles y etiquetas también contaban posts aún no visibles.

## Decisión
- `assertVisible` (comentarios, reacciones a posts y a comentarios) exige que el retraso haya vencido, salvo para el
  autor, que ve su post desde el principio como en el feed. También exige que el negocio autor siga en pie, igual que el feed.
- `shareTarget`, `recordExternalShare`, `mentionContext` y los contadores de perfil y etiqueta aplican la misma condición.
- `publish()` acepta `availableAt`: `UserMentioned` se encola con `available_at = visible_after`, así el aviso sale
  cuando el post se vuelve visible. La cola ya respetaba `available_at` y la alarma de cola atascada lo mide desde ahí.

## Consecuencias
- Prueba en `test/publish-delay.test.ts`.

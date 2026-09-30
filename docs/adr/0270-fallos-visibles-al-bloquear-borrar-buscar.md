# ADR 0270 — La app dice por qué falló bloquear, desbloquear, borrar o buscar

- Estado: Aceptado
- Fecha: 2026-09-30
- Relación con el Blueprint: §13.3 (seguridad del usuario), RF-01; ADR 0054, 0208, 0233
- IA: **NO AI REQUIRED**. Costo: 0.

## Contexto

La auditoría del 2026-09-30 encontró fallos que pasaban en silencio: bloquear devolvía "no bloqueado" sin decir por
qué (p. ej. el tope de ADR 0208); desbloquear marcaba el perfil como desbloqueado aunque el servidor fallara; borrar un
post propio que fallaba no avisaba; y una búsqueda sin conexión parecía "sin resultados".

## Decisión

- `alertFailure(acción)` en `lib/moderation/menu.ts`: diálogo del sistema (igual en iOS y Android) con la acción como
  título y el mensaje ya traducido que da el servidor (`serverErrorMessage`).
- Bloquear, desbloquear (perfil y negocio) y borrar/retirar un post propio lo usan; desbloquear solo cambia la
  pantalla si el servidor lo confirmó.
- Búsqueda: si alguna consulta falla, se muestra el motivo como aviso accesible (`accessibilityRole="alert"`) encima de
  los resultados que sí llegaron.
- `test/no-silent-failures.test.ts` impide volver a `catch(() => undefined)` en esos puntos.

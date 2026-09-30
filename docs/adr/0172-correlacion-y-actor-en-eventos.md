# ADR 0172 — Correlación y actor en los eventos de dominio

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

§6.2 pide que cada evento de dominio lleve un id de correlación y quién lo originó, para seguir una acción de
extremo a extremo (app → API → outbox → consumidores). `platform.outbox.correlation_id` existía pero nadie lo
rellenaba y no había actor.

## Decisión

- `platform/request-context.ts`: `AsyncLocalStorage` con `{ correlationId, actor }`.
- API: el id de petición es el `x-request-id` de la app si es seguro (`[A-Za-z0-9-]{8,64}`); si no, un UUIDv7 nuevo.
  Se devuelve en la cabecera `x-request-id` y en el cuerpo de los 500 (`requestId`). Con sesión, `actor = user:<id>`.
- `publish()` toma correlación y actor del contexto sin que los módulos cambien (54 llamadas). Fuera de una petición
  (tareas del worker) el actor es `system` y la correlación queda vacía.
- El despachador ejecuta cada consumidor con la correlación del evento (o su id) y `actor = system:<consumidor>`:
  lo que publique hereda la correlación, y queda claro que lo hizo el sistema.
- Migración 0079: `platform.outbox.actor` e índice parcial por `correlation_id`. `DomainEvent.actor` en contratos.
- App: cada petición envía un `x-request-id` nuevo; si falla, el error lo guarda y el registro local de errores
  (ADR 0161) lo muestra en "Acerca de", para poder buscarlo en los registros del servidor.

## Consecuencias

- El actor es un id interno, nunca un nombre ni un correo; el outbox se purga a los 14 días (ADR 0165).
- Un cliente puede elegir su id de petición: solo sirve para trazar, no da ningún permiso ni deduplica nada.

# ADR 0097 — "Lo que sigo" y "Bloqueados"

- Estado: aceptada (2026-09-29).
- Blueprint: §5.3 (seguir y bloquear), ADR 0054, ADR 0093
- IA: **NO AI REQUIRED**. Costo: 0.

## Contexto

Se podía seguir eventos, lugares, etiquetas, personas y negocios, y bloquear personas y negocios. Pero no había
dónde ver esas listas ni deshacerlas sin volver a encontrar cada cosa. `GET /v1/me/blocks` existía sin uso en la
app, y `GET /v1/me/follows` devolvía los eventos solo con su id.

## Decisión

- `GET /v1/me/follows` devuelve cada evento seguido con título, categoría y estado.
  - Omite los eventos fusionados en otro: su destino ya se sigue (ADR 0093).
  - Solo consulta ids de evento válidos.
- La app suma dos pantallas al perfil:
  - **"Lo que sigo"**: secciones por tipo (eventos, lugares, etiquetas, personas, negocios). Cada fila abre lo que
    sigue y tiene "Dejar de seguir", con actualización optimista.
  - **"Bloqueados"**: los handles bloqueados, con "Desbloquear".
- `followSections` arma las secciones de forma determinista: solo las que tienen algo, en orden fijo.

## Consecuencias

- Pruebas: `services/core/test/merge-follows.test.ts`, `apps/mobile/test/social-logic.test.ts`.

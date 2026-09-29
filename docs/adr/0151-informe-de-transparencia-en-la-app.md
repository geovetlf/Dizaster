# ADR 0151 — Informe de transparencia en la app de administración

- Estado: aceptada (2026-09-29) · AI_REQUIRED: no · COST: ninguno

## Contexto

El servidor ya genera el informe agregado (`GET /v1/admin/transparency`, ADR 0135) con las cifras 1–4 como "<5",
pero la app no lo mostraba: administración no tenía cómo leerlo ni publicarlo sin herramientas externas.

## Decisión

- Pantalla `admin-transparency` (solo rol admin, desde Perfil): periodos 30/90/365 días; denuncias por motivo,
  casos, acciones (acción · objeto · regla/moderación), reversiones, apelaciones y requerimientos de autoridades.
- `lib/admin/transparency-format.ts`: ordena los desgloses sin convertir ni sumar nunca un "<5" (se ordena como 4,5 y
  se muestra tal cual) y arma un texto plano que se comparte con la hoja nativa del sistema para publicarlo.
- Sin datos nuevos ni rutas nuevas: solo muestra lo que el servidor ya agrega.

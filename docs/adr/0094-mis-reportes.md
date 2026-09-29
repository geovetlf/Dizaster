# ADR 0094 — "Mis reportes"

- Estado: aceptada (2026-09-29).
- Blueprint: §6.1 (`getReport`, `withdrawReport`), §13.2 (transparencia), ADR 0037, ADR 0089
- IA: **NO AI REQUIRED**. Costo: 0.

## Contexto

Una persona podía enviar reportes, pero no tenía forma de ver qué había pasado con ellos. Retirarlos solo se podía
borrando la publicación. Los datos ya existían y solo salían en la exportación completa (ADR 0038).

## Decisión

- `GET /v1/me/reports` devuelve los 200 reportes propios más recientes. Con el límite de 10 por hora, eso cubre
  semanas de uso intenso. Cada uno trae:
  - estado (aceptado, aceptado con menos peso, retirado) y si fue un desmentido;
  - el EVENT al que se sumó;
  - cuándo se borrará o se borró la ubicación precisa;
  - cuántas veces moderación consultó su presencia (ADR 0089), sin decir quién;
  - si se envió sin conexión.
- No incluye el puntaje ni la banda de presencia, las razones antiabuso ni ninguna coordenada: protegen el sistema,
  y el pin ya está en la exportación.
- `DELETE /v1/me/reports/:id` retira el reporte con el mismo `withdraw` de ADR 0037: es idempotente y da 404 si el
  reporte es de otra persona.
- La app suma "Mis reportes" al perfil. Retirar pide confirmación porque no se puede deshacer.

## Consecuencias

- Pruebas: `services/core/test/my-reports.test.ts`, `apps/mobile/test/my-reports.test.ts`.

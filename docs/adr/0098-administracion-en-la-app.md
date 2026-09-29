# ADR 0098 — Herramientas de administración en la app

- Estado: aceptada (2026-09-29).
- Blueprint: §13.1, D-12 (sin panel web), ADR 0026, ADR 0028, ADR 0089, ADR 0090, ADR 0095
- IA: **NO AI REQUIRED**. Costo: 0.

## Contexto

Varias rutas de administración no tenían pantalla, y V1 no tiene panel web:

- presupuestos (`PUT /v1/admin/cost/budgets/:key`);
- sello de negocios y ámbito institucional (`PUT /v1/admin/businesses/:handle/verification` y `/official-scope`);
- registro de consultas de presencia (`GET /v1/admin/presence-access`);
- quitar el autenticador (`POST /v1/me/mfa/totp/disable`).

## Decisión

- **Costo.** Cada presupuesto del tablero se puede tocar para editarlo: periodo (24 h o mes) y tope en USD.
  - `parseUsd` acepta coma decimal y "$", y rechaza negativos, más de 2 decimales y más de 1 000 000.
  - Guardar pide confirmación y avisa que subir un tope de 0 permite gasto real.
- **Negocios e instituciones** (pantalla nueva): se busca por nombre o handle y se cambia el sello.
  - Con "Institución oficial" aparece el editor de ámbito: categorías y países separados por comas.
  - `parseScopeList` normaliza, quita repetidos y muestra lo inválido en lugar de descartarlo.
  - Cada cambio pide confirmación.
- **Consultas de presencia** (pantalla nueva): el registro inmutable de ADR 0089, con motivo, si se vio la ubicación
  precisa y los ids abreviados de la persona, el reporte y el caso.
- **Verificación en dos pasos.** El personal ve la entrada en el perfil y puede quitar su autenticador con un código
  vigente, previa confirmación.
- Todo sigue protegido en el servidor por rol y MFA (ADR 0090). La app solo muestra las entradas al rol que
  corresponde.

## Consecuencias

- Todas las rutas de administración tienen pantalla.
- Pruebas: `apps/mobile/test/admin-tools.test.ts`. Las rutas ya estaban probadas en `services/core`
  (costo, negocios, ADR 0089, ADR 0090 y ADR 0095).

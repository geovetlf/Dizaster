# ADR 0301 — Códigos internos traducidos en moderación y administración

- Estado: Aceptado
- Fecha: 2026-10-01
- Relación con el Blueprint: §11 (idiomas), §13.1 (moderación y administración); ADR 0216, 0281
- IA: no. Costo: 0.

## Contexto

Varias pantallas de moderación y administración mostraban los códigos de la base tal cual:

- en la cola y en el detalle de un caso: el tipo, el estado del contenido y el estado del caso (`POST · HIDDEN · OPEN`);
- en el registro de moderación: el tipo de objetivo;
- en Fuentes: el estado (`ACTIVE`, `PAUSED`…), y la hora de reintento en UTC fijo;
- en Costos: la clave del presupuesto (`ai`).

Además, "24 h" y "N d" estaban escritos en el código, y en francés "d" no se entiende.

## Decisión

1. Tipo de objetivo: se reutilizan las claves `trTarget_*`.
2. Estado del objetivo: `targetStateText` en `lib/moderation/logic.ts`.
   - Un evento muestra su estado de verificación, con la misma etiqueta que el resto de la app.
   - Un post, un comentario, un perfil o un negocio muestran su estado de moderación (`contentState_*`).
   - Un estado desconocido se muestra tal cual, para no esconder información a moderación.
3. Estado del caso: claves `caseStatus_*`.
4. Fuentes:
   - el estado usa las claves `sourceStatus_*`, también en el último cambio de estado;
   - la hora de reintento se muestra en la hora del teléfono.
5. Costos: `budgetLabel` en `lib/admin/cost-format.ts` nombra los presupuestos conocidos (`ai`, `sms`,
   `translation`). Uno nuevo sin traducción muestra su clave.
6. Periodos: claves `period24h` y `periodDays`. En francés, `periodDays` es "{n} j".
7. Todas las claves nuevas están en es, en, pt y fr.

## Consecuencias

- Moderación y administración se leen en el idioma de la persona, sin códigos internos.
- No cambia la API ni ningún dato. Pruebas en `test/moderation-logic.test.ts` y `test/cost-format.test.ts`. La
  prueba de catálogos ya exige que las cuatro lenguas tengan las mismas claves.

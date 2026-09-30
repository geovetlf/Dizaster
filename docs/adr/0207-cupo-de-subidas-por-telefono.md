# ADR 0207 — Cupo de subidas por teléfono, no solo por cuenta

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: reduce el riesgo de gasto en almacenamiento

## Contexto

§5.18 y §12.2 (cost-first y antiabuso). Los reportes ya comparten el cupo entre todas las cuentas de un mismo teléfono
(ADR 0131). Las subidas de fotos y videos solo contaban por cuenta (subidas por hora y MB por día, ADR 0072), así que
varias cuentas en un teléfono multiplicaban el gasto de almacenamiento.

## Decisión

- `media.media.phone_id` (migración 0091) guarda el teléfono de la sesión que pidió la subida: el `phoneId` de ADR 0068
  (primer registro del dispositivo físico). `IdentityService.sessionPhone` lo resuelve desde la sesión del token. No se
  pide nada nuevo a la app y no se puede falsear desde el cuerpo de la petición.
- Tanto el cupo por hora como el de MB por día usan el mayor de los dos consumos: el de la cuenta y el del teléfono.
  El tope de bytes sigue siendo el de la cuenta ajustado por reputación.
- Minimización: el teléfono solo hace falta para las últimas 24 h. La retención diaria de media lo vacía a los 2 días.
- Tokens antiguos sin id de sesión: se aplica solo el cupo por cuenta, como antes.

## Consecuencias

- Crear cuentas extra en el mismo teléfono ya no amplía el cupo de subidas.
- Prueba `media-phone-quota.test.ts`: dos cuentas en un teléfono agotan juntas el cupo, un tercer teléfono sigue
  pudiendo subir, y el dato se vacía a los 2 días.

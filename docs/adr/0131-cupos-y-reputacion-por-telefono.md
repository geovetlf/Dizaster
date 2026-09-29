# ADR 0131 — Cupos y reputación por teléfono

Estado: aceptada (2026-09-29)

## Contexto
§5.20 (DeviceReputation), §8.2 ("reputación del dispositivo y del usuario: ajusta el peso, no la validez") y §12.2
("cuotas por usuario/dispositivo"). Desde el ADR 0068 las cuentas de un mismo teléfono corroboran como una, pero
el cupo de reportes seguía siendo por cuenta: bastaba abrir otra cuenta en el mismo teléfono para duplicarlo o para
volver tras una suspensión.

## Decisión
- El teléfono es el grupo de registros con la misma clave de hardware seudónima (ADR 0068); sin clave, el propio
  dispositivo (`IdentityService.phoneOf`).
- El cupo por hora se cuenta por cuenta y por teléfono: se usa el mayor de los dos conteos contra el cupo de la
  cuenta que reporta.
- Reputación del teléfono (`withPhone`, reglas de Trust): si alguna cuenta del teléfono está suspendida, o si en
  30 días el teléfono acumuló 3 reportes con señales de manipulación (ubicación simulada, salto imposible, firma de
  evidencia inválida, ADR 0129), la cuenta que reporta desde él cuenta como LOW para el cupo (un cuarto del base).
- Solo ajusta el cupo; no bloquea ni invalida reportes. La columna `identity.devices.reputation` (0001) sigue sin
  uso: el estado se calcula al momento desde los datos, sin guardar un número. NO AI REQUIRED; costo cero.

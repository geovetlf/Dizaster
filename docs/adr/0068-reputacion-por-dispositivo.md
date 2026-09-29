# ADR 0068: Varias cuentas en un teléfono corroboran como una

- Estado: aceptada (Blueprint §5.20, §13.3 "reputación por usuario y dispositivo", anti-coordinación)
- IA: **NO AI REQUIRED**. API externa: ninguna. Costo: 0.

## Contexto

El Verification Engine ya contaba una vez por persona y por dispositivo, pero cada cuenta registraba su propio
dispositivo: tres cuentas en el mismo teléfono sumaban tres corroboraciones.

## Decisión

- La app calcula SHA-256 del identificador de instalación del sistema (Android ID / identifierForVendor de iOS) y lo
  envía al registrar el dispositivo. El valor original nunca sale del teléfono.
- El servidor guarda solo `hardware_key` = HMAC-SHA256 de ese resumen con una clave derivada de su secreto (no se
  puede revertir ni cruzar con otras bases).
- `phoneId` = el primer registro de dispositivo con esa clave, de cualquier cuenta. El reporte guarda `phoneId` como
  dispositivo aportante, y la regla existente "una vez por dispositivo" hace el resto.
- Sin identificador (permiso, plataforma): se usa el dispositivo propio, como antes. No bloquea nada.

## Límites conocidos

- En iOS el identificador cambia si se desinstalan todas las apps del mismo proveedor; en Android, si se restablece
  el teléfono. La atestación del dispositivo real (App Attest / Play Integrity) sigue BLOQUEADA por cuentas de
  desarrollador.
- Aún no aplica a los cupos de reportes por hora (siguen por cuenta).

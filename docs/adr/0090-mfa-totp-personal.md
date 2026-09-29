# ADR 0090 — MFA TOTP para moderación y administración

- Estado: aceptada (2026-09-29)
- Blueprint: §13.1 ("MFA para todo acceso administrativo"), ADR 0029, ADR 0048
- IA: **NO AI REQUIRED**. Costo: 0 (sin SMS ni proveedor: TOTP estándar).

## Contexto

Las herramientas de moderación y administración se protegían solo con el rol. Una sesión robada de una persona de
moderación daba acceso a la cola, a la evidencia de presencia y a los interruptores de costo.

## Decisión

- **TOTP (RFC 6238)**: HMAC-SHA1, 6 dígitos y pasos de 30 s, implementado con `node:crypto`, sin paquetes nuevos.
  Funciona con cualquier app de autenticación y acepta un paso de desviación del reloj.
- Protecciones:
  - El secreto se guarda cifrado con FIELD_KEYS (AES-GCM, ADR 0048).
  - Cada paso de 30 s se usa una sola vez (no se puede reutilizar un código).
  - 5 fallos en 15 minutos bloquean nuevos intentos.
  - 8 códigos de recuperación de un solo uso, guardados solo como hash.
- Flujo (solo para quien tiene el rol de moderación o administración):
  - `POST /v1/me/mfa/totp` genera el secreto y un `otpauth://`.
  - `/confirm` lo activa con un código y entrega los códigos de recuperación, que se muestran una vez.
  - `/v1/me/mfa/verify` verifica la sesión con un código TOTP o de recuperación.
  - `/disable` exige un código.
- Guarda: moderación y administración exigen, además del rol, un autenticador activo y la **sesión** (familia de
  tokens, ADR 0029) verificada en las últimas 12 h. Si falta, la respuesta es `MFA_ENROLLMENT_REQUIRED` o
  `MFA_REQUIRED` (403).
- `STAFF_MFA_REQUIRED=auto` la exige solo en producción, y producción no arranca con `false`.
- Borrar la cuenta elimina todo lo del segundo factor.
- App: ante esos errores abre la pantalla "Verificación en dos pasos", que sirve para el alta (clave agrupada y
  botón para abrir la app de autenticación), para verificar y para usar un código de recuperación.

## Consecuencias

- Pruebas: `services/core/test/mfa.test.ts` (incluye vectores del RFC 6238), `apps/mobile/test/mfa-logic.test.ts`.

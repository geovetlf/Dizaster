# ADR 0170 — Inicio de sesión con Apple, Google y correo con código (servidor)

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno por usuario (sin servicios por MAU); el correo
  necesita un proveedor que elegirá el propietario

## Contexto

§5.1 y D-11: Apple + Google + correo; SMS solo como verificación escalonada. Solo existía el acceso de desarrollo
(`/v1/auth/dev`, prohibido en producción) y la interfaz `IdentityProviderVerifier`.

## Decisión

- `OidcIdTokenVerifier` (implementación propia con `jose`): firma con las claves públicas del proveedor (JWKS de
  Apple y Google, descargadas solo cuando alguien entra y cacheadas), emisor, audiencia y vigencia. Audiencias en
  `AUTH_APPLE_AUDIENCES` / `AUTH_GOOGLE_AUDIENCES`; vacías = método apagado (`503 AUTH_PROVIDER_DISABLED`).
- Correo con código de 6 dígitos: 10 min, 5 intentos, un solo uso, pedir otro anula el anterior; como mucho 5 por
  correo y 20 por IP por hora; respuesta idéntica exista o no la cuenta. **El correo no se guarda**: la identidad
  EMAIL usa un HMAC del correo normalizado y el código solo existe como HMAC. Envío detrás de `EmailSender`:
  `none` (apagado, por defecto) o `log` (solo desarrollo; prohibido en producción). Proveedor real: BLOQUEADO.
- Rutas: `POST /v1/auth/apple`, `/v1/auth/google`, `/v1/auth/email/start`, `/v1/auth/email/verify` (mismo par de
  tokens y registro de dispositivo que el acceso de desarrollo); `GET/POST /v1/me/identities` para ver y vincular
  métodos (una identidad de otra cuenta no se mueve: `409 IDENTITY_IN_USE`; fusionar cuentas no entra en V1).
- `/v1/config` anuncia `authProviders` para que la app muestre solo los métodos activos.
- El handle inicial nunca sale del correo ni del nombre del proveedor.

## Pendiente

- Pantalla de inicio de sesión en la app (siguiente punto del backlog).
- Activarlos: client id de Apple (bundle y Services ID) y de Google (Android/iOS), y proveedor de correo, del propietario.

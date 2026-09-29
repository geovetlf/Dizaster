# ADR 0029 — Ver y cerrar sesiones abiertas

- Estado: Aceptado · Fecha: 2026-09-29 · Blueprint §13 (seguridad de cuenta), ADR 0021

## Decisión
- Una **sesión** es un inicio de sesión (familia de refresh tokens de ADR 0021), aunque el token se renueve.
  El token de acceso lleva su id (`sid`) para marcar "este dispositivo".
- `GET /v1/me/sessions`: plataforma, versión de la app, inicio y última actividad. **Sin IP ni ubicación**
  (no se guardan).
- `DELETE /v1/me/sessions/:id` y `POST /v1/me/sessions/revoke-others`: revocan la familia. El token de acceso
  que ya tuviera ese dispositivo no se consulta en cada petición (costo): caduca en ≤ 15 min. Si el
  dispositivo queda sin sesiones activas se borra su token push, así un teléfono perdido deja de mostrar
  alertas.
- Una cuenta suspendida también puede cerrar sesiones.
- App (iOS y Android): "Sesiones y dispositivos" en el perfil.

## Alternativa descartada
- Consultar la sesión en cada petición para cortar el acceso al instante: una lectura más por request.
  Se reconsidera si aparece un caso que lo exija (p. ej. cuentas institucionales).

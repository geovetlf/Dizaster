# ADR 0137 — Quién puede mencionarte

Estado: aceptada (2026-09-29, decisión del propietario: opción A)

## Contexto
§7.3 lista `privacy_settings` en Profile. El propietario decidió: sin perfil privado en V1 (convive mal con los
reportes seudónimos y con la visibilidad pública de la información de emergencia); solo control de quién puede
mencionarte.

## Decisión
- `social.profiles.mentions_from` (migración 0061): EVERYONE (por defecto), FOLLOWING (solo cuentas que sigo) o
  NOBODY. Se cambia con `PATCH /v1/me { mentionsFrom }` y se lee en `GET /v1/me`.
- Al publicar o editar, una mención no permitida no se enlaza: queda como texto, no pinta enlace y no avisa. Se suma a
  las reglas que ya había (bloqueos, anti-spam del ADR 0063).
- App: tres opciones en "Editar perfil". NO AI REQUIRED; costo cero.

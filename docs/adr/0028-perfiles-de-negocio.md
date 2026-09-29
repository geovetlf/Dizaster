# ADR 0028 — Perfiles de negocio

- Estado: Aceptado · Fecha: 2026-09-29 · Blueprint RF-02, §5.4 (V1: perfil de negocio sin verificación de pago), §7 BusinessProfile, D-04

## Decisión
- Una persona administra **hasta 3 negocios** (evita granjas de perfiles). Sin miembros adicionales en V1
  (`BusinessMember` queda para después).
- **Handle** de 3–30 letras minúsculas, números o `_`, único entre personas y negocios, y reservado para siempre
  aunque el negocio se borre (nadie puede suplantar uno antiguo). Se elige al crear y no cambia.
- Datos públicos que el negocio decide publicar: nombre, rubro (lista genérica en `@dizaster/contracts`, no
  depende del país), país, descripción, dirección, teléfono y web (solo `https://`). Nunca se deriva ninguna
  ubicación de nadie.
- **Publicar como negocio** (`asBusiness` en `POST /v1/posts`): solo quien lo administra, nunca seudónimo, con
  el mismo cupo por hora de la persona. Un negocio **no crea REPORTs** (D-04): el flujo de reporte siempre usa
  el perfil de la persona.
- **Verificación gratuita y manual** por administración (`PUT /v1/admin/businesses/:handle/verification`):
  `VERIFIED` o `INSTITUTIONAL_OFFICIAL` (reservado a instituciones oficiales). La app muestra el sello.
- Seguir negocios (`/v1/follows/business/:handle`) suma sus posts a "Siguiendo" y al orden de "Para ti".
- **Moderación**: nuevo objetivo `BUSINESS`. `REMOVE` lo oculta con todos sus posts y le impide publicar
  (quien lo administra aún lo ve); `RESTORE` lo devuelve; avisar o suspender afecta a la cuenta que lo
  administra. Apelable como el resto.
- **Borrado**: borrar el negocio o la cuenta que lo administra borra el perfil, sus posts y sus seguidores.
- Un post de negocio no cuenta en el perfil personal de quien lo administra ni revela quién es.

## Pendiente
- Mencionar negocios con `@` (hoy las menciones enlazan solo personas) y bloquear negocios.
- Varias personas administrando un negocio (`BusinessMember`).

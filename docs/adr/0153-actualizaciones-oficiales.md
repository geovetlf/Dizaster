# ADR 0153 — Posts de actualización oficial de perfiles institucionales

- Estado: aceptada (2026-09-29) · AI_REQUIRED: no · COST: ninguno

## Contexto

§7.3 prevé posts `OFFICIAL_UPDATE` y vínculos `UPDATE`: una institución (bomberos, defensa civil) informa sobre un
evento ("tres unidades en la zona, eviten la avenida"). El tipo existía en el esquema pero nada lo producía; las
instituciones solo podían confirmar o desmentir (ADR 0095).

## Decisión

- `CreatePostRequest.official`: exige `asBusiness` y `eventId`. El perfil debe tener el sello INSTITUTIONAL_OFFICIAL,
  estar visible, tener el ámbito activo y el evento (o el que lo absorbió) debe estar dentro de ese ámbito: la misma
  comprobación que una declaración (`InstitutionService.assertCanPostUpdate`, inyectada en `PostComposer` para no
  cruzar límites de módulo).
- Se guarda como `OFFICIAL_UPDATE` vinculado como `UPDATE`. No es evidencia: no confirma, no desmiente, no mueve la
  verificación. No se edita (como los reportes). Cuenta para el cupo por hora de la persona.
- App: en el evento, la institución con ámbito ve "Actualización oficial · <nombre>", que abre el editor ya
  configurado; la tarjeta del post lleva borde y rótulo "Actualización oficial".
- Pendiente (backlog): aviso push a quienes siguen el evento.

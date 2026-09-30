# ADR 0263 — Moderación de la bio y el nombre del perfil

- Estado: Aceptado
- Fecha: 2026-09-30
- Relación con el Blueprint: §13.3; ADR 0044 (la bio se modera denunciando el perfil), 0088, 0148, 0119
- IA: **NO AI REQUIRED**

## Contexto

Al denunciar un perfil, el caso solo mostraba el nombre visible: la bio nunca llegaba a moderación. Las acciones sobre
perfiles eran quitar la foto, avisar y suspender, así que no había forma de retirar una bio que expone a alguien
(doxxing) o un nombre insultante sin suspender la cuenta. Además, editar el perfil no pasaba por las reglas de datos
personales ni por las listas de términos, a diferencia de posts y comentarios.

## Decisión

- El texto del caso de un perfil es "nombre · bio".
- Nueva acción `CLEAR_PROFILE_TEXT` (solo perfiles): bio vacía y nombre visible = handle. Cierra el caso, queda en el
  registro de acciones con su motivo (visible para la persona afectada, que puede apelar) y no toca cuenta, foto ni
  posts. No es reversible: el texto no se conserva (minimización); la persona puede escribir uno nuevo.
- Editar el nombre o la bio pasa por `detectPersonalData` y las listas de términos con destino `PROFILE`; nada se
  oculta solo, el perfil entra en la cola.
- Migración 0102 amplía el CHECK de `moderation.actions.action`. App: la acción aparece en el caso de perfil, en los
  cuatro idiomas.

## Consecuencias

- Prueba en `services/core/test/avatars.test.ts` y `apps/mobile/test/moderation-logic.test.ts`.

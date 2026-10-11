# ADR 0328 — Exportación con la suspensión y la preferencia del recuento; borrado de avisos de comentarios

- Estado: Aceptado
- Fecha: 2026-10-11
- Relación con el Blueprint: §13.2 (privacidad); ADR 0038, 0295, 0319, 0320, 0321
- IA: **NO AI REQUIRED**. Costo: 0. Sin migración.

## Contexto

La auditoría del 2026-10-11 revisó si «Exportar mis datos» y «Borrar mi cuenta» cubren lo añadido ese día:

| Dato nuevo | Exportación antes | Borrado |
| --- | --- | --- |
| Preferencias `comments` y `replies` (ADR 0320) | Sí (`alerts.preferences` exporta la fila completa) | Sí (se borra la fila) |
| Avisos `COMMENTED` / `REPLIED` recibidos | Sí (`alerts.notifications`) | Sí (por `profile_id`) |
| Avisos que mi comentario generó a otras personas (llevan mi nombre) | No son míos | Sí (por `actor_profile_id`) |
| `show_corroborated_reports` (ADR 0321) | **No** | No aplica (el perfil se anonimiza) |
| `identity.users.suspended_until` (ADR 0319) | **No** | Queda el estado `DELETED` |
| Duración y fin de cada suspensión (`moderation.actions`) | **No** | Se conservan (registro de moderación, ADR 0113) |

## Decisión

- `identity.account` exporta `suspended_until`.
- `moderation.actionsOnMyContent` exporta `suspension` y `suspended_until` de cada acción.
- `social.profile` exporta `show_corroborated_reports`.
- Nada más cambia: sigue sin salir quién moderó ni quién denunció.

## Pruebas

`test/privacy-new-fields.test.ts`:
- la exportación lleva las preferencias de comentarios, la preferencia del recuento y la suspensión propia con su
  duración y fin, sin el id de quien moderó ni el de quien denunció;
- borrar la cuenta de quien comentó retira sus avisos a otras personas y su alerta;
- borrar la cuenta de quien los recibía retira sus avisos y sus preferencias.

## Consecuencias

- La fila de `alert.alerts` de un aviso de comentario (comentario, publicación y quien comentó) no vence: solo se borra
  con la cuenta de quien comentó. Las notificaciones sí vencen con `NOTIFICATION_RETENTION_DAYS`.

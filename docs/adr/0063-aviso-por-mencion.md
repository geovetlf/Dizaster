# ADR 0063: Aviso push por mención

- Estado: aceptada (decisión del propietario D-MENTION, 2026-09-29)
- IA: **NO AI REQUIRED**. API externa: solo el push ya existente (APNs/FCM directos). Costo adicional: 0.

## Contexto

Las @menciones existían (ADR 0027/0054) pero no avisaban. El propietario decidió enviar push al ser mencionado,
respetando horas de silencio, preferencias, bloqueos, privacidad, anti-spam y deduplicación.

## Decisión

- `indexPostText` publica `UserMentioned {postId, authorProfileId, profileIds}` solo con las menciones **recién
  enlazadas** (el `INSERT … ON CONFLICT DO NOTHING RETURNING` ya excluye repetidas, a uno mismo y a quien bloqueó al autor).
- El Alert Engine (`alert.mention`) crea una alerta `MENTION` por post (`dedup_key = MENTION:<post>`) y una notificación
  por persona (`UNIQUE (profile_id, alert_id)`): una misma mención nunca avisa dos veces, aunque el outbox reentregue.
- Pasa por la misma cola que los EVENTs: horas de silencio, límite por hora, agrupación, idioma e historial. Nunca es
  crítica (no rompe el silencio).
- Filtros antes de avisar:
  - el post sigue visible (no borrado, `VISIBLE`, público);
  - la persona existe y no bloqueó a la persona ni al negocio autor (`social.mentionContext`);
  - preferencia nueva `mentions` (activa por defecto, apagable en Ajustes de alertas);
  - anti-spam: una cuenta avisa como mucho a 20 personas por hora y 3 veces a la misma persona en 24 h
    (`MENTION_LIMITS`). La mención sigue visible en el post; solo no genera aviso.
- Privacidad: el texto es "@autor te mencionó" o, si el post es seudónimo, "Te mencionaron en una publicación". Nunca
  lleva el texto del post. `actor_profile_id` se guarda solo para el anti-spam, no sale por la API, y se borra con la
  cuenta del autor (junto con sus avisos a otras personas).
- El aviso lleva a `dizaster://post/<id>`; la app acepta ese destino además de `event/`, `alerts` y `admin-cost`.
- Migración 0035: `alert.alerts.event_id`/`category_code`/`severity`/`public_state` pasan a opcionales para MENTION,
  con un CHECK que exige post xor evento.

## Consecuencias

- `NotificationView` gana `postId`; `eventId` y `categoryCode` pueden ser null (solo en menciones).
- Si el post se borra después, el aviso queda en el historial y el post muestra "no disponible".

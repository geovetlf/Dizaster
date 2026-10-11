# ADR 0320 — Avisos de comentarios y respuestas: apagados por defecto

- Estado: Aceptado
- Fecha: 2026-10-11
- Relación con el Blueprint: §5.10 (Alert Engine); decisión aprobada en ADR 0315; ADR 0063, 0141, 0174
- IA: **NO AI REQUIRED**. Costo: 0 (mismo envío push propio). Migración 0109.

## Contexto

Solo había avisos por mención (ADR 0063). El propietario aprobó el 2026-10-11 avisos de comentarios y respuestas con
cuatro condiciones:
- apagados por defecto en V1;
- la persona puede activarlos;
- un límite diario configurable;
- que no compitan con las alertas de incidentes y emergencias.

## Decisión

**Qué avisa.**
- Comentaron mi publicación: tipo `COMMENT`, motivo `COMMENTED`.
- Respondieron a mi comentario: motivo `REPLIED`. Si es la misma persona, gana `REPLIED`.
- Nunca avisa a quien comenta, a quien lo bloqueó, ni si el comentario o la publicación ya no se ven.
- Las publicaciones de negocios no avisan.
- El texto nombra a quien comentó y nunca incluye el comentario. Lleva a la publicación.

**Apagados por defecto.**
- Dos preferencias nuevas, `comments` y `replies`, en `false` (migración 0109, columnas con valor por defecto).
- Las cuentas existentes quedan también apagadas.
- La app las muestra en «Avisos» junto a las menciones.

**Límite diario.**
- `SOCIAL_NOTICES_PER_DAY` (10 por defecto; 0 los apaga para todos) limita los avisos sociales por persona en 24
  horas.
- Por encima del límite, el comentario sigue ahí pero no se crea el aviso.
- El valor 10 es un valor técnico de partida: se cambia por configuración, sin código.

**No compiten con los incidentes.**
- El comentario publica `CommentAdded` en el carril `batch` del outbox, el último: el trabajo de incidentes
  (`urgent`, `interactive`) siempre pasa antes.
- En cada envío, los avisos sociales van al final de la cola.
- No cuentan en el límite por hora de la persona (`maxPerHour`), así que nunca dejan en silencio a un aviso de
  incidente.
- Salen en su propio push: no se agrupan con un aviso de incidente ni lo tapan.
- Respetan las horas de silencio y el interruptor general.

## Pruebas

`test/comment-notices.test.ts`:
- apagados por defecto y activables;
- sin el texto del comentario;
- comentar lo propio no avisa;
- las respuestas;
- los bloqueos;
- el tope diario;
- no gastan el límite por hora y salen en su propio push;
- horas de silencio.

## Consecuencias

- Una persona que activa los avisos y recibe muchos comentarios ve como mucho 10 al día. El resto de los
  comentarios están en la publicación.
- Un comentario oculto por moderación después de avisar no retira el aviso ya enviado. Al abrirlo, el comentario ya
  no se ve.

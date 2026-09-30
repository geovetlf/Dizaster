# ADR 0179 — Sensibilidad de un evento por su contexto

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

§7 (flag SENSITIVE del evento) y el Anexo A.5 ("se generaliza según categoría, riesgo y contexto"). La sensibilidad
salía solo de la categoría y nunca cambiaba: un incendio en un albergue de víctimas mostraba el punto con el detalle
de un incendio cualquiera.

## Decisión

- `POST /v1/moderation/events/:id/sensitivity` (verificadores y moderación) con `to` (SENSITIVE o
  HIGHLY_SENSITIVE) y motivo. Solo sube: bajar expondría lo que ya se protegió (409 `SENSITIVITY_NOT_RAISED`).
- Se recalculan desde el punto real el punto público, su celda, el lugar contextual y región/distrito con la nueva
  sensibilidad (misma función `generalize` de siempre). Migración 0086: `event.sensitivity_log`, de solo inserción.
- Evento `EventSensitivityRaised`: el feed vuelve a generalizar el punto de los posts de reportes del evento.
- App de moderación: sección "Sensibilidad" en la ficha del evento, con los niveles superiores y el historial.

## Consecuencias

- Lo que ya se descargó (teselas en caché de la CDN, pantallas abiertas) caduca con su tiempo normal.
- No hay acción de moderación desde denuncias para esto: se hace desde la ficha del evento, como la gravedad.

# ADR 0017 — Seguir (perfiles, eventos, lugares) y orden determinista del feed

- Estado: Aceptado · Fecha: 2026-09-29 · Blueprint §8.4 (Social Engine), ADR 0015, ADR 0016

## Decisión
- **Seguir** vive en `social.follows` con `target_type` abierto (PROFILE, BUSINESS, EVENT, TAG, PLACE). V1 expone
  personas, eventos y lugares del índice geográfico (`PUT/DELETE /v1/follows/{profile|event|place}/{id}`), con un
  máximo de 2000 por perfil. El módulo feed valida que el destino exista antes de guardarlo.
- **Privacidad**: seguir a alguien nunca muestra sus posts seudónimos; su perfil público no los lista ni los cuenta.
- **Feed "Siguiendo"** (fan-out on read, Blueprint): posts públicos de personas seguidas + posts vinculados a
  eventos seguidos + posts de eventos cuyo distrito o región se sigue. Por recientes.
- **"Para ti"** con orden determinista, sin ML: puntuación = hora de publicación + ventaja en horas por señal:
  verificación (oficial +6, externa +4, comunitaria +2, disputado −6, falso −24), severidad (+1,5 por nivel sobre 1),
  cercanía del lector (<1 km +6, <5 km +4, <25 km +2) y autor seguido (+4). Ventana de 30 días.
  Como la ventaja es acotada, lo nuevo siempre acaba arriba; como la puntuación no depende de "ahora", el cursor
  (puntuación, id) no repite ni salta entre páginas.
- **Señales sin cruzar esquemas**: social mantiene `social.event_signals` (severidad, estado público, región,
  distrito) como proyección alimentada por el outbox (EventCreated, EventEvidenceAdded, VerificationChanged).
- **Perfiles**: `GET /v1/profiles?q=` (handle o nombre), `GET /v1/profiles/{handle}`, `.../posts`, `GET /v1/me`,
  `GET /v1/me/follows`.

## Consecuencias
- Coste: consultas sobre índices propios; sin servicios externos. Con cuentas muy seguidas se pasará a feed
  materializado (fan-out on write), ya previsto en el Blueprint.
- Los "me gusta" no influyen en el orden (cambian entre páginas y serían fáciles de manipular); se revisará con
  métricas anti-abuso.

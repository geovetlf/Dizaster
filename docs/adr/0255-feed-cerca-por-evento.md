# ADR 0255 — Feed "Cerca" también por la ubicación del evento

Fecha: 2026-09-30 · Estado: aceptada · NO AI REQUIRED

## Contexto
"Cerca" (§5.3) filtraba y ordenaba solo por `social.posts.public_point`. Un post sin ubicación propia pero ligado a un
evento cercano (una pregunta o una actualización sobre ese evento) no aparecía, aunque es justo lo que interesa a
quien está cerca.

## Decisión
- `social.event_signals` guarda `public_point`: el punto PÚBLICO (generalizado) del evento, nunca el preciso
  (migración 0100). Lo mantiene `FeedService` desde `EventService.publicStates` al crear el evento, al sumar evidencia
  y al subir su sensibilidad. Los eventos ocultos o retrasados no se proyectan.
- El filtro de "Cerca", la distancia en tramos y el impulso por cercanía de "Para ti" usan
  `coalesce(p.public_point, s.public_point)`: primero el punto del post y, si no tiene, el de su evento.

## Consecuencias
- No se expone ninguna ubicación nueva: el punto público del evento ya sale en el mapa.
- Prueba en `test/feed-nearby-event.test.ts`.

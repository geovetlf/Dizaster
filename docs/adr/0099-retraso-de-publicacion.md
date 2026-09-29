# ADR 0099 — Retraso de publicación en categorías HIGHLY_SENSITIVE

- Estado: aceptada (2026-09-29). Cuántos minutos: **en espera** de decisión de producto (hoy 0 en todas).
- Blueprint: §8.5 ("HIGHLY_SENSITIVE: … posible retraso de publicación")
- IA: **NO AI REQUIRED**. Costo: 0 (una consulta indexada cada 30 s en el worker).

## Contexto

En categorías como violencia, publicar en tiempo real puede poner en riesgo a quien reporta o a la víctima: quien
causa el daño sigue cerca y puede ver el aviso en el mapa.

## Decisión

- **Configuración.** `publishDelayMinutes` por categoría en `categories.json` (0 a 1440; por defecto 0), también
  como override por país.
  - Solo vale para HIGHLY_SENSITIVE: el catálogo no carga si se pone en otra categoría.
- **El evento espera.** Un EVENT creado por un reporte ciudadano en una categoría con retraso nace `DELAYED`, con
  `publish_after`. Mientras tanto:
  - no sale en el mapa, la búsqueda, los cercanos, las alertas ni por enlace;
  - la deduplicación interna sí lo ve, así que otros reportes se suman a él en lugar de crear otro.
  - Si llega evidencia de una fuente no ciudadana (oficial o externa), se publica en el acto: esa información ya es
    pública.
  - Un evento pendiente de corroboración que se corrobora antes de la hora pasa a `DELAYED`, no a `PUBLISHED`.
- **Publicación.** El worker publica cada 30 s los vencidos (`publishDue`) y emite `EventPublished`, que dispara la
  evaluación de alertas como un evento nuevo.
- **El post también espera.** El post del reporte lleva `visible_after`: hasta esa hora solo lo ve su autor en el
  feed.
- **Aviso a quien reporta.** La respuesta del reporte trae `publishAfter`, y la app lo dice: "Por seguridad, se
  publicará a las HH:MM".
- `nextPublication` y `publishDelayMinutes` son funciones puras y probadas.

## Pendiente (decisión de producto)

- Cuántos minutos para `crime.violence`: hoy es 0, y con 0 el comportamiento no cambia en nada.
- `emergency.missing_person` no se reporta por ciudadanos, así que no le aplica.

## Consecuencias

- Moderación tampoco abre la ficha pública de un evento retrasado hasta su hora; sí lo ve en sus colas.
- Pruebas: `services/core/test/publish-delay.test.ts`, `apps/mobile/test/report-outcome.test.ts`.

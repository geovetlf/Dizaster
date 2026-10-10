# ADR 0309 — Lecturas públicas con volumen: planes probados y "Para ti" sin puntuar todo el mes

- Estado: Aceptado
- Fecha: 2026-10-10
- Relación con el Blueprint: §5.22 (rendimiento y SLO), §8.4 (orden de "Para ti"); ADR 0118, 0124, 0201, 0255, 0282
- IA: **NO AI REQUIRED**. Costo: 0 (sin índices nuevos ni migraciones).

## Contexto

El riesgo 3 del informe de preparación era "latencia sin datos reales": las pruebas de carga corrían sobre una base
casi vacía, y con tablas pequeñas PostgreSQL recorre la tabla entera aunque falte un índice.

Se cargaron 20 000 eventos, 40 000 posts y 40 000 comentarios, con su timeline, evidencia, señales y enlaces
evento-post. Luego se pidió el plan de cada SELECT que lanzan las lecturas públicas calientes. Hallazgos:

| Lectura | Problema | Tiempo medio (local) |
| --- | --- | --- |
| Feed "Para ti" | Puntuaba **todos** los posts de 30 días para quedarse con 20 | 285 ms; 1,2–1,5 s con sesión |
| Feed "Cerca" | Filtro por `coalesce(punto del post, punto del evento)`: ningún índice espacial servía | 214 ms; 1,2 s con sesión |
| Perfil, etiqueta, evento, búsqueda | Ordenaban por una expresión (`epoch / 3600`), no por la columna indexada | 33 ms en el perfil |
| Media del evento | `ref_id::text = …` impedía usar el índice de evidencia | recorría `event.evidence` |
| Fin de fuentes (worker) | Lo mismo con `ref_id::text = ANY(…)` | recorría `event.evidence` |

## Decisión

1. **Corte por ventaja acotada en "Para ti".** La puntuación es la hora del post más una ventaja acotada:
   - como máximo +22 h: oficial +6, gravedad 5 +6, a menos de 1 km +6, autor seguido +4;
   - como mínimo −63 h.

   Se piden primero los `limit` posts más nuevos, recorriendo el índice por fecha. La menor de sus puntuaciones es un
   piso que la página alcanza seguro. Un post cuya hora más +22 h no llega a ese piso no puede entrar, así que la
   consulta principal solo puntúa desde ahí.
   - `MAX_RANK_BOOST_HOURS` y `MIN_RANK_BOOST_HOURS` se derivan de `RANK_BOOST_HOURS`. Si cambia una ventaja, el
     corte cambia solo.
   - El orden resultante es **idéntico** al de puntuar todo el mes. La prueba lo compara página a página, con y sin
     sesión, cerca y por categoría, con posts viejos a los que la ventaja hace ganar.
2. **Cota de fecha del cursor.** Con `score < cursor`, ningún post es más nuevo que `cursor − ventaja mínima`.
   - En "Para ti" se usa esa cota.
   - En las pestañas sin ranking, la cota es el cursor mismo.

   Así las páginas siguientes también entran por el índice.
3. **Sin ranking, se ordena por `created_at, id`.** Da el mismo orden que la puntuación, porque `epoch / 3600` es
   estrictamente creciente, y usa `posts_feed_idx`.
4. **"Cerca" con candidatos por índice.** Une los posts cuyo punto está en el radio (`posts_public_point_idx`) y los
   posts de eventos cuyo punto está en el radio (`event_signals_point_idx`). El filtro exacto sigue siendo el de
   ADR 0255.
5. **Comparaciones por `uuid`, no por texto**, en la media del evento y en el fin de fuentes.
6. **Prueba permanente** (`services/core/test/volume-plans.test.ts`). Hace el mismo volumen en cada `pnpm check` y
   falla si una lectura pública caliente recorre entera una tabla grande:
   - eventos, posts, comentarios, timeline, evidencia, enlaces y señales;
   - de mapa, tesela, ficha, timeline, verificación, media, fuentes, feed ("Para ti", "Cerca", videos y por categoría, con y sin sesión), perfil,
     post, comentarios y etiqueta.

   Se probó que la prueba detecta un corte demasiado estrecho y una cota de cursor sin la ventaja mínima.
   `FeedFilter.exhaustive` existe solo para esa comparación.

## Resultado (misma máquina, mismo volumen)

| Lectura | Antes | Después |
| --- | --- | --- |
| "Para ti" con sesión | 1176–1530 ms | 19 ms |
| "Cerca" con sesión | 1170 ms | 6 ms |
| "Para ti" sin sesión | 271–285 ms | 17 ms |
| Posts del perfil | 33 ms | 4 ms |
| Resto de lecturas medidas | 2–6 ms | 1–6 ms |

## Consecuencias

- "Para ti" hace dos consultas cortas en vez de una larga.
- En un pico, lo que crece con el volumen es la franja de posts dentro de la ventaja: unas 22 h más la caída del
  piso. Ya no son los 30 días.
- Sigue abierto el riesgo de latencia en el entorno real: la nube, la red y los datos verdaderos se miden en staging
  (D-18, D-23). Esta prueba evita la regresión más cara, que es el recorrido completo de tablas.

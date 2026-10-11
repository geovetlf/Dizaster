# ADR 0322 — Lo añadido el 2026-10-11 y la salud de fuentes, con volumen

- Estado: Aceptado
- Fecha: 2026-10-11
- Relación con el Blueprint: §5.22 (rendimiento en picos), §13.2 (retención); ADR 0162, 0293, 0309–0313, 0317–0321
- IA: **NO AI REQUIRED**. Costo: 0 (dos índices parciales; sin servicios nuevos).

## Contexto

Las pruebas de volumen de ADR 0309–0313 son anteriores a lo que se añadió el 2026-10-11 (ADR 0317–0321). Se pasó
lo nuevo por el mismo método, en `services/core/test/volume-decision-plans.test.ts`:
- el aviso de un comentario o respuesta: contexto, tope diario y envío (ADR 0320);
- el fin de las suspensiones (ADR 0319);
- «N reportes corroborados» en el perfil y en `/v1/me` (ADR 0321).

Se añadió también la vista de fuentes de administración con meses de corridas, que ninguna prueba cargaba.

Volumen:
- 20 000 cuentas y perfiles, una de cada ocho suspendida;
- 40 000 acciones de moderación;
- 40 000 posts y 40 000 comentarios;
- 20 000 alertas de comentario con 60 000 avisos;
- 10 000 eventos y 40 000 reportes, más de 3000 de una misma persona;
- 92 días de corridas de las 11 fuentes, una cada 10 minutos (145 000).

La nueva función `rowsReadDuring` (en `test/query-plans.ts`) repite cada SELECT con `EXPLAIN ANALYZE` y cuenta las
filas que lee de cada tabla. Así detecta un recorrido por índice que lee toda la historia de una clave, que no sale
como Seq Scan.

Lo que no tenía problemas:
- El aviso de un comentario: contexto, bloqueos, tope diario (`notifications_social_idx`) y envío con avisos sociales
  pendientes. Una persona en el tope no recibe más; otra por debajo, sí.
- El perfil público y `/v1/me` de quien tiene miles de reportes, sin sesión, con otra sesión y con la propia. El
  recuento coincide con una referencia escrita aparte.
- La generalización a 7 días en categorías sensibles (ADR 0318) ya la cubría ADR 0311.
- `launchStatus` (ADR 0317) no consulta la base de datos.

Lo que sí tenía problemas:

| Dónde | Problema |
| --- | --- |
| `/v1/admin/sources` | Agregaba **todas** las corridas de cada fuente (90 días) para sacar la última corrida, la última correcta y las cifras del día. El último error se buscaba por fecha, y en una fuente sana recorría toda su historia. Leía 159 000 filas por petición. |
| Retención diaria de corridas | `DELETE … WHERE raw_ref IS NULL AND started_at < …` recorría `ingestion.runs` entera. |
| Fin de suspensiones (cada hora) | Una lectura de `moderation.actions` por cada cuenta reactivada (N+1), dentro de la transacción. |

## Decisión

- Migración 0111, con dos índices parciales sobre `ingestion.runs`. Ninguno pesa en las tablas calientes:
  - `(source_id, started_at DESC) WHERE status = 'FAILED'`, para el último error;
  - `(started_at) WHERE raw_ref IS NULL`, con el mismo predicado que la retención.
- `IngestionService.adminSources` consulta por separado la última corrida, la última correcta y el último error, cada
  uno con `ORDER BY started_at DESC LIMIT 1`. Las cifras del día se agregan solo sobre `started_at > now - 24 h`. El
  resultado es el mismo: lo comprueba la prueba contra la consulta anterior, fuente por fuente.
- `ModerationService.expireSuspensions` lee la última suspensión de todas las cuentas reactivadas en una consulta
  (`unnest` y `LATERAL … LIMIT 1`). El orden, el registro `UNSUSPEND_USER` y el objeto de cada uno no cambian.

## Resultado (misma máquina, mismo volumen)

| Qué | Antes | Después |
| --- | --- | --- |
| `/v1/admin/sources` (consulta) | 210–300 ms, 159 000 filas | < 1 ms, menos de 1700 filas |
| Selección de la retención de corridas | 18,6 ms (Seq Scan) | 0,2 ms (Index Only Scan) |
| Fin de 250 suspensiones | 251 consultas de lectura | 2 |

Sin estos cambios, la prueba falla en esos tres puntos.

## Consecuencias y límites

- «N reportes corroborados» lee todos los reportes de la persona y busca su evidencia y su evento por clave. Con 3000
  reportes son unos 20 ms por vista, sin recorrer tablas. Bajarlo exigiría guardar el recuento ya calculado, que
  pasaría a ir con retraso respecto a la verificación. Eso es una decisión de producto y no se toma aquí.
- La búsqueda de eventos por texto sigue sin índice de trigramas (ADR 0291). Tiene su propio cupo y queda pendiente de
  datos de uso reales.
- El recuento de no leídos (badge) lee todos los avisos de la persona en los últimos 90 días. Con 4500 avisos tarda
  menos de 1 ms. No se añade un índice parcial por `read_at`: haría más cara cada lectura de un aviso en la tabla que
  más crece.
- La retención de `verification.ai_jobs` (una fila por evento, 30 días) recorre su tabla. Es pequeña y solo existe
  con la IA encendida.
- Los tiempos son locales. La latencia real se mide en staging (D-18, D-23).

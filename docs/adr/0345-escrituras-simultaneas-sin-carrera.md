# ADR 0345 — Reportes, contadores y tope de avisos sociales sin carrera

- Estado: Aceptado
- Fecha: 2026-10-11
- Relación con el Blueprint: §4.2 (consistencia), §13.3 (cupos); ADR 0118, 0131, 0132, 0268, 0320
- IA: **NO AI REQUIRED**. Costo: 0. Migración 0119.

## Contexto

`services/core/test/concurrency-writes.test.ts` envía peticiones simultáneas con `Promise.all` sobre `app.inject` y
procesa el outbox con varios workers a la vez sobre el mismo pool. Encontró cuatro fallos. Las dos primeras
comprobaciones del reporte se hacían fuera de la transacción y sin candado.

1. **Reporte enviado dos veces a la vez** (reintento offline): el segundo chocaba con
   `UNIQUE (author_user_id, client_report_id)` y respondía **500**, aunque el reporte sí quedaba creado. La app lo
   reintentaba como fallido.
2. **Cupo por hora y tope diario de reportes** (ADR 0131, 0132): 9 envíos simultáneos pasaban con un cupo de 5.
3. **Contadores sociales** (ADR 0118, migración 0050): los triggers recalculan el post con READ COMMITTED. El recuento
   de una escritura simultánea usaba la foto tomada antes de esperar el bloqueo de la fila. Ocho «me gusta» y cuatro
   «ya no» simultáneos dejaban `likeCount` en 6 o 7 en vez de 4. Lo mismo pasaba con `comment_count` y `share_count`.
   El dato quedaba desfasado hasta la siguiente escritura.
4. **Tope diario de avisos de comentarios** (ADR 0320): contar y crear no era atómico. Con varios workers, ocho
   comentarios simultáneos dejaban 6 avisos con un tope de 3.

`expireSuspensions` simultáneo ya era correcto: el `UPDATE … WHERE status = 'SUSPENDED'` serializa por fila. Cada
cuenta se reactiva y se registra una vez. Ahora tiene su prueba.

## Decisión

Sin cambiar la semántica de ninguna regla:

1. y 2. Al empezar la transacción del reporte se toma `pg_advisory_xact_lock` por cuenta (`report.submit:<usuario>`)
   y por teléfono (`report.submit-phone:<phoneId>`, ADR 0068), siempre en ese orden. Dentro del candado se repiten:
   - la búsqueda del reintento: si otro envío ya lo creó, se devuelve su respuesta;
   - el recuento del cupo.
   La comprobación previa sin candado sigue: rechaza pronto sin hacer el trabajo caro.
3. Migración 0119: `refresh_post_*` pasa a plpgsql.
   - Primero toma la fila del post con `FOR NO KEY UPDATE`, el mismo modo que ya tomaba el `UPDATE`. No choca con las
     claves foráneas que apuntan al post, así que no añade interbloqueos.
   - Después recalcula en una sentencia nueva, con una foto que ya incluye lo confirmado por quien tenía el bloqueo.
   - Sigue siendo recalcular, nunca +1/−1.
   - La migración corrige además los contadores desfasados, solo en las filas que no cuadran.
4. `AlertService.comment` toma un candado por destinatario (`alert.social-notice:<perfil>`), en orden fijo, antes
   de contar los avisos del día.

## Pruebas

`concurrency-writes.test.ts` (6 casos). Sin los cambios fallaban cuatro: 500 en el reintento, 9 de 5, `likeCount` 6
o 7 de 4, y 6 avisos de 3. Con los cambios pasan en tres ejecuciones seguidas.

## Consecuencias

- Dos reportes simultáneos de la misma cuenta o del mismo teléfono se procesan uno detrás de otro. Es lo que haría
  una sola persona con un solo teléfono.
- Escrituras simultáneas sobre el mismo post esperan su turno en el recálculo, igual que antes en el `UPDATE`.

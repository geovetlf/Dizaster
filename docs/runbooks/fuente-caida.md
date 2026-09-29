# Fuente caída o que publica datos erróneos

## Detección
- Fuentes con carril URGENT: al abrirse el circuit breaker, administración recibe un push "fuente caída" y otro al
  recuperarse (`SourceHealthChanged`, ADR 0058), además del log `ingestion.source.health`.
- El worker registra cada consulta como `{"msg":"ingestion.run", ...}` con `status` OK, NOT_MODIFIED, FAILED o
  SKIPPED_CIRCUIT_OPEN, y la tabla `ingestion.runs` guarda el historial.
- Tras 3 fallos seguidos el circuit breaker deja de consultar la fuente con espera exponencial (máx. 6 h, ADR 0011):
  no hace falta intervenir para que deje de insistir.

```sql
SELECT s.key, r.status, r.http_status, r.started_at, r.error
  FROM ingestion.runs r JOIN ingestion.sources s ON s.id = r.source_id
 WHERE s.key = '<clave>' ORDER BY r.started_at DESC LIMIT 20;
```

## Si la fuente no responde
1. Comprobar si es la fuente o la red (misma URL desde otra red; página de estado del emisor).
2. Si es una fuente **oficial de alertas**, avisar a comunicación: la app sigue mostrando lo ya recibido, pero no
   llegará nada nuevo por ese canal. Los reportes ciudadanos y otras fuentes siguen funcionando.
3. No hay que hacer nada más: el circuit breaker reintentará solo.

## Si la fuente publica datos erróneos (formato cambiado, ubicaciones absurdas, avalancha de elementos)
1. Pausarla: `pnpm source-status <clave> PAUSED` (ADR 0127). Lo ya ingerido no se borra.
2. Si generó eventos falsos: moderación los marca desde la cola (DISPUTED/FALSE con motivo) o fusiona duplicados;
   un error de datos nunca se corrige borrando filas.
3. Revisar el adapter con un ejemplo real guardado (`raw_ref`, ADR 0075) y añadirlo como fixture de prueba.
4. Reactivar: `source-status <clave> ACTIVE` después de desplegar el arreglo.

## Cambiar qué tipos de la fuente se aceptan
Es dato: `config.categoryMap` o `eventMap` en `data/source-registry/sources.json` (ADR 0122). El servicio valida el
registro al arrancar y se niega a arrancar con un mapeo inválido.

## Datos mal interpretados ya ingeridos

Tras corregir el adapter o el mapa de categorías de la fuente (`data/source-registry/sources.json`), re-procesar el
crudo guardado en lugar de esperar a que la fuente vuelva a publicar (ADR 0133):

```sh
pnpm reprocess-source <clave> [desde AAAA-MM-DD] [hasta AAAA-MM-DD]
```

Solo cambia lo que cambió; queda como corrida `REPROCESS` en `ingestion.runs`. El crudo existe solo dentro de la
retención (`SOURCE_RAW_RETENTION_DAYS`).


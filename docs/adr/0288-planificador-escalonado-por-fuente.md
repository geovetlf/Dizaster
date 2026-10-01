# ADR 0288 — Carril NORMAL escalonado por fuente

- Estado: Aceptado
- Fecha: 2026-10-01
- Relación con el Blueprint: §9.2 ("planificador diario escalonado por fuente"); ADR 0159
- IA: no. Costo: 0.

## Contexto

Todas las fuentes del carril NORMAL tenían el mismo horario (`0 5 * * *`), salvo PTWC y FIRMS, que corrían cada 6 horas
en el minuto 0. Las corridas ya eran secuenciales, pero el lote diario completo vencía en el mismo tick. Además,
un horario mal escrito caía en silencio al valor por defecto, las 05:00.

## Decisión

1. El escalonamiento es **dato**, no código. En `data/source-registry/sources.json`, cada fuente diaria tiene su
   propio minuto a partir de las 05:00 UTC, cada 5 minutos: USGS a las 05:00 y WHO a las 05:40. FIRMS pasa a
   `30 */6`, así no coincide con PTWC.
2. Una prueba lee el registro y falla si:
   - un horario no tiene el formato que entiende el planificador (`SCHEDULE_PATTERN`), porque caería en silencio
     al valor por defecto;
   - dos fuentes comparten el mismo horario.

## Consecuencias

- Una fuente nueva tiene que elegir un minuto libre. Lo exige la prueba, sin tocar el código.
- El carril URGENT no cambia: sigue sus propios intervalos y va siempre primero.

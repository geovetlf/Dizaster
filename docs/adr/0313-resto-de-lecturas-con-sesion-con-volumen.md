# ADR 0313 — Resto de lecturas con sesión con volumen

- Estado: Aceptado
- Fecha: 2026-10-10
- Relación con el Blueprint: §5.22 (rendimiento en picos), §13.3 (transparencia); ADR 0026, 0038, 0135, 0310, 0312
- IA: **NO AI REQUIRED**. Costo: 0 (solo pruebas y documentación).

## Contexto

ADR 0310 y 0312 cubrieron 16 lecturas con sesión y de moderación. Quedaban sin probar con volumen las demás lecturas
`GET` de `/v1/me` y `/v1/admin`. Se pasaron por el mismo volumen de `test/volume-session-plans.test.ts`.

## Decisión

Diez lecturas no recorren ninguna tabla grande y pasan a la prueba de cada `pnpm check`:
- de administración: costos, acceso a originales, cambios de configuración, solicitudes de autoridades, equipo,
  cambios del equipo y fuentes;
- de la persona: mi cuenta, preferencias de alertas y mis negocios.

Tres se dejan fuera a propósito:

| Lectura | Por qué queda fuera |
| --- | --- |
| `/v1/admin/quality` y `/v1/admin/transparency` | Son informes que cuentan todo lo de un periodo (eventos, avisos, casos, denuncias, acciones, apelaciones). Si el periodo abarca casi todos los datos, recorrer la tabla es el plan correcto. Solo los pide administración, a demanda. Un índice por fecha en cada tabla haría más lenta cada escritura en las tablas que más crecen, para acelerar una lectura rara. No se agregan. |
| `/v1/me/export` | No es representativa con filas clonadas. El cifrado de cada campo va atado al id de su fila, y los clones copian el texto cifrado con otro id, así que descifrarlo falla. Además tiene un tope por sección (ADR 0295) y una espera de un minuto entre exportaciones. Desde ADR 0316, un valor ilegible ya no tumba la exportación. |
| `/v1/me/policies` | No consulta la base de datos. |

## Consecuencias y límites

- Si los informes de calidad o de transparencia llegan a pesar en producción, se resuelve con un resumen diario
  agregado, no con índices en las tablas calientes.
- Los tiempos son locales. La latencia real se mide en staging (D-18, D-23).

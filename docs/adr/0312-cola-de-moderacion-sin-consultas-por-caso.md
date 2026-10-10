# ADR 0312 — Cola de moderación sin consultas por caso

- Estado: Aceptado
- Fecha: 2026-10-10
- Relación con el Blueprint: §5.22 (rendimiento en picos), §13 (moderación); ADR 0134, 0236, 0310
- IA: **NO AI REQUIRED**. Costo: 0 (sin índices ni servicios nuevos).

## Contexto

ADR 0310 dejó anotado un límite: la cola de moderación y las apelaciones arman cada fila de la página con consultas
propias. Medido con el volumen de `test/volume-session-plans.test.ts` (20 000 casos y 60 000 denuncias):

| Petición | Consultas | Tiempo |
| --- | --- | --- |
| Cola, 50 casos | 151 | 29,9 ms |
| Cola, 20 casos (por defecto) | 61 | 11,7 ms |
| Apelaciones, 50 | 53 | 14,8 ms |

Por cada caso, la cola volvía a leer el caso que ya tenía, contaba sus denuncias por motivo y armaba la vista previa
del objeto. Las apelaciones piden una fila de más para saber si hay otra página, y también le armaban la vista previa
aunque luego se descartaba.

## Decisión

- La consulta de la cola ya trae todas las columnas del resumen, las mismas de antes (`CASE_COLUMNS`, con la toma
  vencida oculta). Los motivos de toda la página salen de una sola consulta: `case_id = ANY($1) GROUP BY case_id,
  reason`, con el índice `flags_case_idx` (ADR 0310). El detalle de un caso usa el mismo camino con un solo caso.
- Las apelaciones no arman la vista previa de la fila de más.
- La vista previa del objeto sigue siendo una por fila. Depende del tipo de objeto y vive en otros módulos (social,
  eventos, media), y está acotada por el tamaño de página.

No cambian los filtros, los permisos, la toma de casos, el orden, el cursor ni lo que devuelve cada fila.

`test/volume-session-plans.test.ts` pide la cola y las apelaciones con 10 y con 50 filas. Las 40 filas de más pueden
costar como mucho una consulta cada una, más un margen de dos para el único objeto real de la prueba. Con el código
anterior, la cola falla: 119 consultas de más.

## Resultado (misma máquina, mismo volumen, media de 5 peticiones)

| Petición | Antes | Después |
| --- | --- | --- |
| Cola, 50 casos | 151 consultas, 29,9 ms | 52 consultas, 14,4–19,9 ms |
| Cola, 20 casos | 61 consultas, 11,7 ms | 22 consultas, 6,8–7,1 ms |
| Apelaciones, 50 | 53 consultas, 14,8 ms | 52 consultas, 13,7–16,1 ms (dentro del ruido) |

## Consecuencias y límites

- La vista previa sigue costando de una a tres consultas por fila según el tipo de objeto (un post con fotos son
  tres). Agruparla pediría una versión por lotes en social, eventos y media. Con páginas de 20 casos no compensa
  todavía.
- Los tiempos son locales. La latencia real se mide en staging (D-18, D-23).

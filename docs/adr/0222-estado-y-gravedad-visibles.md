# ADR 0222 — Estado del ciclo de vida y gravedad visibles para el público

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

§7.3 y §10.1 definen la gravedad (1 a 5) y el estado del ciclo de vida (activo, en seguimiento, resuelto, archivado)
como dimensiones independientes de la verificación. La API ya los enviaba, pero ninguna pantalla pública los
mostraba. El mapa pasaba la gravedad sin usarla, y la lista accesible (ADR 0200) no mostraba gravedad aunque la ADR
lo decía.

## Decisión

- El evento muestra, bajo la etiqueta de verificación, "En seguimiento · Gravedad 4 de 5".
- La lista accesible del mapa agrega la misma línea.
- En el mapa, el radio del círculo crece con los reportes agrupados y, 1,5 px por punto, con la gravedad.
- La gravedad se acota a 1–5 al mostrarla. Textos locales en los cuatro idiomas.

## Consecuencias

- Quien lee distingue lo grave de lo leve y lo que sigue pasando de lo que ya pasó, sin confundirlo con la verificación.
- Prueba en `event-status.test.ts`.

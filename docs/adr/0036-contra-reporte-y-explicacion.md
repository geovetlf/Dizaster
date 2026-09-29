# ADR 0036 — "Aquí no pasa nada" y explicación de la verificación en la app

- Estado: Aceptado · Fecha: 2026-09-29 · Blueprint §10.2, §10.4, ADR 0012

## Contexto
El servidor ya aceptaba contra-reportes (`assertion: NOT_OCCURRING`) y los usaba para la bandera DISPUTED, y
guardaba una explicación por regla, pero la app no ofrecía ninguna de las dos cosas.

## Decisión
- Pantalla de evento: botón **"Aquí no pasa nada"** que abre el reporte presencial ya apuntado a ese evento y a su
  categoría, con `NOT_OCCURRING`. Pasa por las mismas reglas de presencia, cupo y reputación que cualquier reporte.
- Sección **"Por qué este estado"**: una línea por regla que aportó (confirmaciones independientes frente al
  umbral, negaciones presentes, fuentes externas, confirmación o desmentido oficial) y el recuento de evidencias
  separado por origen (ciudadana, externa, oficial). Nunca muestra quién reportó.
- La cronología usa etiquetas legibles; un tipo nuevo que la app no conoce se muestra tal cual (tipo abierto).
- Sin cambios en el servidor ni en las reglas.

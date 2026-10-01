# ADR 0294 — Feed de inicio sin conexión

- Estado: Aceptado
- Fecha: 2026-10-01
- Relación con el Blueprint: §3 principio 6 (offline-tolerante); ADR 0066 (lectura sin conexión), C-04
- IA: no. Costo: 0.

## Contexto

La lectura sin conexión (ADR 0066) guardaba avisos, mapa y eventos abiertos, pero no el feed de inicio. Sin red, la
primera pantalla de la app mostraba solo "No se pudo cargar", justo cuando más se necesita ver qué está pasando.

## Decisión

1. La primera página del feed de inicio se guarda con `readThrough`, igual que avisos y eventos: con red se muestra lo
   fresco y se guarda; sin red, la copia con la marca "copia guardada" y su hora (`OfflineNote`).
2. Se guarda por pestaña y categoría: "Para ti", "Siguiendo" y "Videos". "Cerca de mí" no se guarda, porque su
   respuesta depende de dónde está el teléfono, y la clave nunca lleva coordenadas ni texto libre (solo un código del
   catálogo o `all`).
3. Con la copia a la vista no se piden más páginas; deslizar para actualizar vuelve a intentar con red.
4. Mismos límites que ADR 0066 (60 entradas, 7 días). Borrar la cuenta vacía la copia (ADR 0211).

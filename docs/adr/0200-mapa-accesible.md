# ADR 0200 — Mapa accesible: lista de eventos y grupos que se acercan

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

§11.4 y §5.6: el mapa dibuja los eventos como círculos en GL, distinguidos solo por color (categoría) y borde
(verificación). Con lector de pantalla no había forma de recorrerlos, y sin distinguir colores faltaba información.
Además, tocar un grupo (modo agrupado) no hacía nada.

## Decisión

- Botón "Ver como lista" junto a Emergencia: lista de los eventos de la vista actual (los mismos que dibuja el
  mapa, con los mismos filtros), con título o categoría, lugar y estado de verificación en texto. Orden: más grave,
  luego más oficial, luego más reciente (`mapListOrder`). En modo agrupado explica que hay que acercar el mapa.
- Tocar un grupo acerca el mapa dos niveles sobre él (`clusterZoom`, entre 6 y 16), sin animación si el sistema pide
  reducir movimiento.
- El mapa tiene nombre accesible que indica cómo recorrerlo.
- Sin peticiones nuevas: la lista usa la respuesta que ya tiene el mapa.

## Consecuencias

- Igual en Android e iOS. Prueba: `apps/mobile/test/map-a11y.test.ts`.

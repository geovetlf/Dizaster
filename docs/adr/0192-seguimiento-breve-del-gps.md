# ADR 0192 — Seguimiento breve del GPS mientras se redacta el reporte

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

§8.2: la presencia usa la precisión del fix y la regla de "movimiento imposible" compara lecturas recientes. La app
tomaba una sola lectura: la precisión se quedaba en la primera (a menudo 100 m o más al salir de un edificio) y la
trayectoria casi nunca tenía datos, así que esa regla no se aplicaba.

## Decisión

- En la pantalla de redactar, `watchPositionAsync` (solo primer plano, cada 5 s, como mucho 2 min, se detiene al
  salir de la pantalla). Sin permiso de ubicación "siempre" ni en segundo plano (D-16 intacto).
- Cada lectura entra en la trayectoria (`pushRecent`: sin repetidos, las 10 más recientes).
- Una lectura reemplaza al fix solo si es más precisa, posterior y el fix aún no llega a 50 m (`betterFix`). Si la
  persona no movió el pin, el pin la sigue; si lo movió, se respeta.
- Mientras el fix sea peor que 50 m se muestra "Afinando tu ubicación… puedes enviar igual": nunca bloquea el envío.
- El servidor sigue recalculando todo; el teléfono solo recoge datos.

## Consecuencias

- Mejor precisión en la presencia y la regla de velocidad imposible con datos reales, igual en Android e iOS.
- Prueba: `apps/mobile/test/fix-refine.test.ts`.

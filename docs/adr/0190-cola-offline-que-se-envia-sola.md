# ADR 0190 — La cola offline se envía sola: tiempo límite, vuelta de la red y segundo plano

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

§8.3 y C-04: un reporte guardado sin red debe salir en cuanto se pueda. ADR 0158 solo reintentaba con la app
abierta y con espera creciente; además, una petición con red mala podía quedarse colgada sin límite (la cola no
avanzaba) y la vuelta de la red no se detectaba.

## Decisión

- `fetchWithTimeout` (30 s) en todas las peticiones JSON a la API y en la descarga de catálogos. Al vencer falla
  como error de red (sin `status`): la cola lo trata como "sin conexión" y lo reintenta. Las subidas de media
  siguen por el módulo nativo en streaming (sin este límite: un video puede tardar).
- `expo-network`: al pasar de sin red a con red se envía la cola al instante (`cameOnline`, probado). Cambiar de
  Wi-Fi a datos no dispara nada.
- `expo-background-task` + `expo-task-manager` (módulos oficiales de Expo, MIT): tarea `dizaster.report-queue` cada
  ≥ 15 min cuando el sistema lo permite (WorkManager en Android con red; BGTaskScheduler en iOS). Se define al
  cargar el bundle (`index.ts`) y se registra una vez con sesión.
- La tarea solo envía si la app sigue viva con sesión en memoria. **No** renueva el refresh rotatorio desde segundo
  plano: si la app se abriera a la vez, el mismo refresh se usaría dos veces y la sesión se cerraría. Con la app
  cerrada del todo, el reporte sale al abrirla (como antes).

## Consecuencias

- Hace falta un build nuevo (módulos nativos); `native:check` confirma paridad iOS/Android. La prueba en teléfono
  real queda para el primer build de desarrollo (bloqueado por EXPO_TOKEN).
- Prueba: `apps/mobile/test/connectivity.test.ts`.

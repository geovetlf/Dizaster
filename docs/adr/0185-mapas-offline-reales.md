# ADR 0185 — Mapas offline reales: config persistida y un solo estilo

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

§11.3: las zonas guardadas se pueden descargar para verlas sin red (ADR de regiones offline). Dos fallos lo
impedían en la práctica:

1. La config remota (`/v1/config`, que trae la URL del estilo) solo se pedía por red. Sin red no había URL de
   estilo y el mapa caía al fondo liso aunque los tiles estuvieran descargados.
2. Las regiones se descargaban con el estilo claro (`alert-settings.tsx`) y el mapa principal usa el oscuro: lo
   descargado no era lo que se mostraba.

## Decisión

- `lib/config/config-cache.ts` (lógica pura, probada) + `lib/config/app-config.ts` (SQLite, tabla `app_config`
  de una fila en `dizaster.db`). `appConfig()` sustituye a `api.config()` en todas las pantallas: red si hay, si
  no la última guardada, **sin caducidad por edad** y sin borrarse al cerrar sesión (no es dato personal).
  Varias pantallas a la vez comparten una sola petición y la respuesta se reutiliza 5 minutos: menos tráfico.
- `APP_MAP_SCHEME = "dark"` (la app tiene un único tema oscuro, `theme.ts`): todos los mapas y las descargas usan
  ese estilo. El fondo sin red pasa a un gris oscuro coherente con el tema.

## Consecuencias

- Una región descargada se ve igual sin red, en Android e iOS.
- Sin red, los interruptores remotos (ADR 0082) y la versión mínima usan la última config conocida; el servidor
  sigue decidiendo al subir.
- Prueba: `apps/mobile/test/config-cache.test.ts`.

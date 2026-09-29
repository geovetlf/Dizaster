# ADR 0082 — Kill switches remotos de video y subidas

- Estado: aceptada (2026-09-29)
- Blueprint: §12.2 (kill switch de video), §5.18 (KillSwitch), ADR 0019
- IA: **NO AI REQUIRED**. Costo: 0; sirve para cortar el mayor costo variable (almacenamiento y salida de media).

## Contexto

Los kill switches existían para IA, traducción y SMS, pero la media, el costo variable más grande del V1, no se
podía apagar sin desplegar.

## Decisión

- Dos interruptores nuevos en `cost.kill_switches`: `media-upload` (todas las subidas) y `video` (solo videos).
  `POST /v1/media/uploads` responde `503 FEATURE_DISABLED` antes de firmar ninguna URL si el que corresponde está
  apagado. Los reportes y publicaciones siguen funcionando sin media.
- `/v1/config` los expone en `killSwitches`; `mediaAvailability()` (contracts) traduce a `{ photo, video }`. La app
  oculta los botones que no aplican y explica que la media está pausada. Sin red, la app muestra las opciones y el
  servidor decide al subir.
- El tablero de costos lista todos los interruptores conocidos (`KNOWN_KILL_SWITCHES`) aunque nunca se hayan tocado,
  para poder apagarlos desde la app de administración.
- No se usa `CostGuard.check` para media: la media no tiene gasto por llamada (se mide en almacenamiento mensual) y
  sin presupuesto definido `check` bloquearía todo. Los topes por cuenta siguen siendo la cuota diaria (ADR 0072).

## Consecuencias

- Pruebas: `services/core/test/media-kill-switch.test.ts`.

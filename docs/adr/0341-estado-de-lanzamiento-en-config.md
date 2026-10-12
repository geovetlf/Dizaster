# ADR 0341 — Estado de lanzamiento por país en `/v1/config`

- Estado: Aceptado
- Fecha: 2026-10-11
- Relación con el Blueprint: §8.2 (envío de reportes), §11.5 (países); ADR 0315, 0317
- IA: **NO AI REQUIRED**. Costo: 0. Sin migraciones.

## Contexto

ADR 0317 decide qué países aceptan reportes ciudadanos: solo los `PILOT` y `AVAILABLE`. El servidor lo aplica al
recibir el reporte. La app calcula el mismo estado con `data/countries/country-config.json` empaquetado (PR #70). Así,
abrir un país nuevo exigía publicar otra versión de la app para que esta lo mostrara bien. Preguntar al servidor por
la ubicación del dispositivo no es una opción: la app no debe enviar su ubicación para eso.

## Decisión

- `AppConfig` gana el campo opcional `launch` (`CountryLaunchConfig` en `@dizaster/contracts`):
  - `version`: la del archivo de países;
  - `defaults`: `{ launchStatus, acceptsCitizenReports }` para los países sin entrada;
  - `countries`: `[{ iso2, launchStatus, acceptsCitizenReports }]`.
- Tiene la misma forma que el archivo empaquetado (`defaults` + `countries`). La app puede usar la misma función con
  el archivo o con la respuesta.
- Se genera con `ReferenceData.launchConfig()` a partir de `data/countries/country-config.json`.
- `acceptsCitizenReports` usa la misma regla que el control del servidor. No cambia qué estados aceptan reportes.
- Solo publica código, estado y si acepta reportes. No publica notas internas, edad mínima ni otros campos del
  archivo, ni nada de la persona.
- La respuesta mantiene `cache-control: public, max-age=300`: es igual para todos y no depende de la sesión.
- Es opcional: un servidor anterior no lo envía y la app sigue con su archivo empaquetado.

## Pruebas

`test/config-launch-and-suspension.test.ts`: `/v1/config` valida contra `AppConfig`. Cada país y el valor por
defecto coinciden con el archivo y con `launchStatus`/`acceptsCitizenReports` del servidor. Cada entrada trae solo
los tres campos.

## Consecuencias

- Abrir un país es un cambio de datos y despliegue del servidor. La app lo ve en ≤ 5 minutos sin versión nueva, una
  vez que lea `launch`. Leerlo en la app queda para el frente móvil.
- El servidor sigue siendo la autoridad: aunque la app tenga un dato viejo, el envío se rechaza o se acepta en el
  servidor.

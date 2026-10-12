# ADR 0334 — La app lee el estado de lanzamiento de `/v1/config`

- Estado: Aceptado
- Fecha: 2026-10-12
- Relación con el Blueprint: §8.2 (envío de reportes), §11.5 (países); ADR 0185, 0317, 0332, 0341
- IA: **NO AI REQUIRED**. Costo: 0. Sin migraciones. Solo `apps/mobile`.

## Contexto

ADR 0332 hizo que la pantalla de reporte no deje preparar un reporte en un país que no acepta reportes ciudadanos.
Lo calculaba solo con la copia empaquetada de `data/countries/country-config.json`. Abrir un país exigía entonces
publicar otra versión de la app para que esta lo mostrara bien. ADR 0341 publicó el mismo dato en `/v1/config`
(campo opcional `launch`) y dejó su lectura en la app para el frente móvil.

## Decisión

- La pantalla de reporte, con el primer fix y el país ya calculado en el teléfono, pide `appConfig()` (la misma config
  con caché en memoria de 5 minutos y copia en SQLite, ADR 0185) y le pasa `config.launch` a `reportsOpenIn`.
  - Espera como mucho `LAUNCH_CONFIG_WAIT_MS` (3 s). Casi siempre ya está en memoria porque la pantalla la pidió al
    abrir para el mapa. Si no llega a tiempo o falla, usa el archivo empaquetado.
  - `/v1/config` no lleva parámetros: la ubicación no sale del teléfono para esto.
- `effectiveLaunchConfig(bundled, remote)` decide qué datos rigen:
  - `launch` se valida con `CountryLaunchConfig` de `@dizaster/contracts`. Si falta, es `null` o está mal formado
    (estado desconocido, `iso2` inválido, campos que faltan…), se usa el bundle.
  - Gana la versión más nueva (`compareDatasetVersions`, como el catálogo de categorías). Con la misma versión se usa
    la del servidor. Una config guardada antes de actualizar la app, con versión más vieja que el bundle, no lo pisa.
- `reportsOpenWith` acepta reportes solo si el estado es `PILOT` o `AVAILABLE` **y** el dato no trae
  `acceptsCitizenReports: false`. El indicador puede cerrar, nunca abrir: un estado de solo lectura con
  `acceptsCitizenReports: true` sigue cerrado.
- Lo que acepta reportes no cambia (ADR 0317). El servidor sigue siendo la barrera real (`COUNTRY_READ_ONLY`): aunque
  la app tenga un dato viejo, el envío se rechaza o se acepta allí.

## Pruebas

`apps/mobile/test/launch-config.test.ts`:
- con `launch` válido y más nuevo, un país recién abierto acepta reportes;
- sin `launch` (`undefined` o `null`), el bundle;
- mal formado (ocho variantes), el bundle, y nunca abre;
- la versión más nueva gana, también con versiones de dos cifras (`09.10` > `09.3`);
- `acceptsCitizenReports: false` cierra; `true` no abre un estado cerrado;
- con el archivo real, sin config, con una más vieja o con basura da lo mismo que el bundle;
- sin red, se usa el `launch` de la última config guardada;
- la pantalla de reporte lo lee de `appConfig()`.

`test/account-restrictions.test.ts` se ajusta a la nueva llamada.

## Consecuencias

- Abrir o cerrar un país es un cambio de datos y despliegue del servidor. La app lo refleja en ≤ 5 minutos, sin
  versión nueva.
- Sin red y sin config guardada, la app sigue con su bundle, como antes.

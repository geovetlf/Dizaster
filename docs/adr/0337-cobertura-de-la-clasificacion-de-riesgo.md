# ADR 0337 — Cobertura de la clasificación de riesgo: archivos sensibles sin regla y renombres

- Estado: Aceptado
- Fecha: 2026-10-11
- Relación con el Blueprint: §20.2, §20.16; ADR 0262, 0265
- IA: **NO AI REQUIRED**. Costo: 0. Sin migraciones.

## Contexto

Auditoría del Delivery Control Plane (`dzd`) del 2026-10-11 sobre el repositorio real (`git ls-files`):

- **Archivos sensibles sin regla.** Caían en la clase por defecto (`medium`: staging `auto`, producción `review`) en
  lugar de `critical` (producción `approval`):
  - `services/core/src/platform/field-cipher.ts`: el cifrado por columna (ADR 0048). Las reglas nombraban
    `platform/crypto*.ts` y `platform/auth*.ts`, que no existen.
  - `services/core/src/http/app.ts`: la verificación del token, el límite de escrituras de cuentas suspendidas y el
    límite de peticiones.
  - `services/core/src/http/log.ts`: los logs sin IP ni query string (ADR 0142, 0204).
  - `services/core/src/modules/media/**`: quita el GPS de fotos y videos (`sanitize.ts`).
  - `data/source-registry/**`: qué cuenta como fuente oficial.
  - En la app: `apps/mobile/src/lib/emergency.ts` y `emergency-store.ts`. La regla decía
    `apps/mobile/src/lib/emergency/**`, una carpeta que no existe. También `lib/auth/**`, `lib/report/**`
    (anonimato y presencia) y `lib/media/**` (redacción). Son la contraparte de módulos del backend que ya eran
    críticos.
- **Renombres.** `analyze()` clasificaba solo la ruta de destino. Un `git mv` de un archivo crítico a `docs/` salía
  `low`: por ejemplo, sacar `.github/workflows/ci.yml` o un archivo de `identity/`. Una migración renombrada fuera de
  su carpeta no se marcaba `blocked`, pese a que la regla dice que una migración existente no se renombra ni se borra.
- Lo que ya estaba bien:
  - Las migraciones 0108–0110 y todas las anteriores son `critical`, ninguna es destructiva, y piden regresión
    completa, restauración del respaldo y ADR.
  - `alert`, `event`, `report`, `identity`, `verification`, `ingestion`, `moderation` y `trust` eran críticos.

## Decisión

1. `delivery/policy.json` marca como `critical` los archivos de la lista anterior, cada uno con el motivo de su
   regla. Se conservan como nombres reservados `platform/auth*.ts`, `platform/crypto*.ts` y
   `apps/mobile/src/lib/emergency/**`: si se crean, nacen críticos.
2. Un renombre se clasifica por la clase más alta entre su origen y su destino. El motivo dice
   `(origen <ruta>)`. Sacar una migración de su carpeta es `blocked`, como borrarla.
3. `tools/delivery/test/coverage.test.ts` prueba la política contra el repositorio real:
   - ningún glob muerto, salvo los reservados;
   - todo el código de los módulos sensibles es `critical`;
   - cifrado, autenticación, logs y su contraparte móvil son `critical`;
   - workflows, IaC, la política, los chequeos y `security/` son `critical`;
   - las migraciones 0108–0110 cumplen lo de arriba;
   - un renombre o un borrado de algo crítico no baja de clase.

   Con la política anterior, dos de esas pruebas fallan.

## Consecuencias

- Más cambios piden aprobación del propietario para producción. Con el nivel de autonomía vigente (2) nada se
  despliega solo, así que el efecto inmediato es el informe del PR, que ahora dice la verdad.
- Un archivo sensible nuevo fuera de las carpetas cubiertas sigue saliendo `medium`. La prueba de cobertura no lo
  adivina: la lista de módulos sensibles de la prueba y la política se actualizan juntas.

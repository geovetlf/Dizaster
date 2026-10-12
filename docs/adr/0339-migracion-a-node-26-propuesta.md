# ADR 0339 — Migración a Node 26 LTS: condición de activación y alcance

- Estado: **Propuesto** (no se aplica hasta cumplir la condición de activación y tener el visto bueno del propietario)
- Fecha: 2026-10-11
- Relación con el Blueprint: §16, §20.7; ADR 0273, 0308
- IA: **NO AI REQUIRED**. Costo: 0. Sin migraciones.

## Contexto

El ADR 0308 dejó Node 22 en todo el repositorio. La migración va a una LTS en un único PR que alinee `.nvmrc`,
`engines`, las imágenes y CI. El agente la propone después del 2026-10-28. El análisis completo está en
`docs/node-26-migracion.md`.

## Propuesta

1. **Activación.** Se abre el PR solo si es después del 2026-10-28 y `nodejs.org/dist/index.json` muestra la última
   `v26.x` con `lts` distinto de `false`. Hoy no se cumple: `v26.11.1`, `lts: false`.
2. **Alcance.** Cambian juntos `.nvmrc`, `engines.node`, los dos `FROM` de `infra/docker/core.Dockerfile` (por
   digest), `@types/node` en los cuatro paquetes con su lockfile, el comentario de `.github/dependabot.yml` y los
   requisitos de `README.md` y `docs/MOBILE_PLATFORMS.md`. Los workflows no cambian: leen `.nvmrc`. El PR #41
   (Node 25) se cierra.
3. **Bloqueante conocido.** Node 25 y posteriores no traen `corepack`. Comprobado en el tarball oficial de 26.11.1.
   `RUN corepack enable` de `core.Dockerfile` se reemplaza por pnpm fijado a `packageManager`.
4. **Verificación.** `pnpm check` con Node 26, CI completo (incluye build y Trivy de la imagen), imagen en local con
   `dzd deploy --env local` + `dzd verify --slo`, y staging manual por el propietario con 24 a 48 h de observación.
5. **Rollback.** `git revert` del PR, que es atómico, y `dzd rollback` al digest anterior. No hay cambios de datos.

## Resultado de la prueba previa con Node 26.11.1 (sin cambiar archivos)

- **Pasan:** `lint`, `check:boundaries`, `check:secrets`, `check:workflows`, `typecheck` y `build`.
- **Pruebas** (`pnpm -r --no-bail run test`, con la base y el S3 de pruebas): pasan 1262 de 1262.
  - Por paquete: contracts 42, delivery 128, geo-kit 39, mobile 294 y core 759.
  - En core, las 4 pruebas de `s3-storage.test.ts` fallaron porque el servidor S3 de pruebas estuvo caído. Repetidas
    con Node 26: 7/7.
  - En una corrida anterior, una prueba de `tools/delivery` que lanza subprocesos pasó del límite de 5 s (tardó 5,2 s
    con la suite en paralelo). Ese límite se subió a 30 s en el PR de esta rama. No es una incompatibilidad.
- **Sin probar:** `@types/node` 26, la imagen Docker (no hay daemon en el entorno de análisis) y EAS.

## Consecuencias

- Mientras siga Propuesto, nada cambia: `check:workflows` sigue exigiendo 22 en todas partes.
- Si en la fecha de activación aparece una incompatibilidad que no figura aquí, se registra en este ADR y la
  migración espera. Node 22 tiene soporte hasta el 2027-04-30.

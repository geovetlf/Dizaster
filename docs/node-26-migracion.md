# Migración a Node 26: análisis previo (sin aplicar)

Estado: **análisis**. Aquí no se cambia nada: `.nvmrc`, `engines`, las imágenes y los workflows siguen en Node 22. La
decisión y su condición de activación están en el ADR 0339 (Propuesto). Fecha del análisis: 2026-10-11.

## 1. Condición de activación

Se abre el PR de migración solo cuando se cumplan las dos cosas:

1. Es **después del 2026-10-28**.
2. Node 26 es **LTS de verdad**, no solo según el calendario. Se comprueba el mismo día:
   - `https://nodejs.org/dist/index.json`: la última `v26.x` tiene `"lts"` con un nombre en clave, no `false`.
   - `https://raw.githubusercontent.com/nodejs/Release/main/schedule.json`: `v26.lts` ≤ hoy.

Hoy (2026-10-11) **no se cumple**:

- la última versión es `v26.11.1` (2026-10-07), con `"lts": false`;
- el calendario oficial dice `v26`: inicio 2026-05-05, LTS **2026-10-28**, mantenimiento 2027-10-20, fin 2029-04-30.

Node 22 tiene soporte hasta el 2027-04-30, así que no hay urgencia. Node 24 entra en mantenimiento el 2026-10-20, y 26
es el destino que fija el ADR 0308. El agente propone el PR y lo fusiona el propietario.

## 2. Inventario de dependencias

Se leyó `node_modules/.pnpm` del worktree: 831 paquetes instalados con el lockfile actual.

### 2.1 Directas, con su campo `engines.node`

Ningún `engines` de los 831 paquetes excluye Node 26.

| Paquete | Rango | Instalada | `engines.node` | Dónde |
| --- | --- | --- | --- | --- |
| eslint, @eslint/js | ^10 | 10.12.0 / 10.0.1 | `^20.19.0 \|\| ^22.13.0 \|\| >=24` | raíz (dev) |
| typescript | ~6.0.3 | 6.0.3 | `>=14.17` | todos (dev) |
| typescript-eslint | ^8.71.1 | 8.71.1 | `^18.18.0 \|\| ^20.9.0 \|\| >=21.1.0` | raíz (dev) |
| globals | ^17.13.0 | 17.13.0 | `>=18` | raíz (dev) |
| vitest | ^5.0.3 | 5.0.3 | `^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0` | todos (dev) |
| tsx | ^4.20.0 | 4.23.15 | `>=18.0.0` | core (dev) |
| @types/node | ^22.20.5 | 22.20.5 (además está la 26.6.4 como transitiva) | — | contracts, geo-kit, core, delivery (dev) |
| fastify | ^5.12.5 | 5.12.5 | — | core |
| pg | ^8.23.1 | 8.23.1 | `>= 16.0.0` | core |
| sharp | ^0.35.5 | 0.35.5 | `>=20.9.0` | core |
| jose | ^6.2.12 | 6.2.12 | — | core |
| zod | ^4.6.5 | 4.6.5 | — | contracts, core |
| fast-xml-parser | ^5.11.2 | 5.11.2 | — | core |
| geo-tz | 8.1.9 | 8.1.9 | `>=16` | core |
| uuid | ^14.0.2 | 14.0.2 | — | core, mobile |
| h3-js | ^4.5.0 | 4.5.0 | `>=4` | geo-kit |
| @opentelemetry/* (api, sdk-trace-node, resources, exporter-trace-otlp-http, instrumentation, -http, -pg) | 1.9 / 2.12 / 0.223 / 0.75 | ídem | `^18.19.0 \|\| >=20.6.0` (api: `>=8.0.0`) | core |
| @fastify/otel | ^0.21.1 | 0.21.1 | — | core |
| react-native | 0.86.3 | 0.86.3 | `^20.19.4 \|\| ^22.13.0 \|\| ^24.3.0 \|\| >= 25.0.0` | mobile |
| expo y expo-* (SDK 57) | ~57.0.x | 57.0.x | — | mobile |
| @noble/curves, @noble/hashes | ^2.4.0 | 2.4.0 | `>= 20.19.0` | mobile |
| react | 19.2.3 | 19.2.3 | `>=0.10.0` | mobile |
| @maplibre/maplibre-react-native, react-native-screens, react-native-safe-area-context | — | — | — | mobile |
| @protomaps/basemaps | 5.7.2 | 5.7.2 | — | raíz (dev) |

### 2.2 Binarios nativos

| Paquete | Tipo | Riesgo con Node 26 |
| --- | --- | --- |
| `sharp` 0.35.5 → `@img/sharp-linux-x64` | Addon N-API (ABI estable entre versiones de Node) | Bajo. Cargó con Node 26.11.1 (libvips 8.18.7) y las pruebas de media pasaron |
| `@rolldown/binding-linux-x64-gnu` 1.2.12 (vitest/vite) | N-API | Bajo. vitest corrió con Node 26 |
| `lightningcss-linux-x64-gnu` 1.33.0 (Metro/Expo) | N-API | Bajo. Solo empaquetado móvil |
| `esbuild` 0.28.2 (tsx, vite) | Ejecutable propio, no addon | Ninguno |
| `react-native-worklets` 0.13.0 | Binarios de Android/iOS, no de Node | No aplica al runtime de Node |

`NODE_MODULE_VERSION` de Node 26 es 147. Ningún paquete compila un addon con node-gyp en la instalación (`pnpm` deja
los scripts de construcción sin aprobar).

### 2.3 Hallazgo que rompe el build de la imagen

**Node 26 no trae `corepack`.** Desde Node 25 deja de distribuirse. Comprobado en el tarball oficial
`node-v26.11.1-linux-x64.tar.xz` (sha256 `3883bfc7…b651`): `bin/` solo tiene `node`, `npm` y `npx`.
`infra/docker/core.Dockerfile` hace `RUN corepack enable` en la etapa de build, así que con `node:26-*` ese paso falla.
El PR de migración tiene que instalar pnpm de otra forma, fijada a `packageManager` (`pnpm@10.33.0`). Por ejemplo,
`npm install -g pnpm@10.33.0` en la etapa de build: npm sí viene en esa etapa y la imagen final lo sigue borrando.
CI no se ve afectado, porque `pnpm/action-setup` instala pnpm por su cuenta.

## 3. Archivos que se alinean en un solo PR (ADR 0308)

`pnpm check:workflows` falla si la versión mayor de `.nvmrc`, `engines` y `core.Dockerfile` no coincide.

| Archivo | Hoy | Cambio |
| --- | --- | --- |
| `.nvmrc` | `22` | `26` |
| `package.json` → `engines.node` | `>=22.12` | `>=26` (o la menor de 26 que sea LTS) |
| `infra/docker/core.Dockerfile` (dos `FROM`) | `node:22-bookworm-slim@sha256:c3de60bf…8392` | `node:26-bookworm-slim@sha256:<digest resuelto ese día>`. El 2026-10-11 el índice era `sha256:86f07bc9…4567`, pero se vuelve a resolver |
| `infra/docker/core.Dockerfile` (`RUN corepack enable`) | corepack | pnpm fijado sin corepack (§2.3) |
| `packages/contracts`, `packages/geo-kit`, `services/core`, `tools/delivery` → `@types/node` | `^22.20.5` | `^26.x` (y `pnpm-lock.yaml`) |
| `.github/dependabot.yml` | comentario "@types/node sigue a Node 22" | "sigue a Node 26". Se mantiene el `ignore` de mayores |
| `README.md`, `docs/MOBILE_PLATFORMS.md` | "Node 22" | "Node 26" |
| ADR nuevo + `docs/IMPLEMENTATION_STATUS.md` | — | Registro de la migración (cierra el ADR 0339) |

No cambian:

- **Los workflows** (`ci.yml`, `deliver.yml`, `mobile-build.yml`): usan `node-version-file: .nvmrc`.
- **`scripts/check-workflows.mjs`**: compara versiones, no las fija.
- **`apps/mobile/eas.json`**: no fija Node, así que EAS usa el de su imagen. Fijarlo es una decisión aparte, porque
  cada build de EAS cuesta cupo.
- **OpenTofu**: Cloud Run usa la imagen por digest.

PR #41 (Node 25) se cierra sin fusionar: lo reemplaza este PR.

## 4. Lo que ya se probó con Node 26, sin cambiar archivos (2026-10-11)

- **Binario.** Node `v26.11.1`, del paquete `node-linux-x64` de npm, con el integrity de npm verificado. También el
  tarball oficial, contra `SHASUMS256.txt`. pnpm 10.33.0 corre sobre él.
- **Se ejecutó.** Sobre el worktree de esta rama: `pnpm lint`, `check:boundaries`, `check:secrets`,
  `check:workflows`, `typecheck`, `build` y `pnpm -r --no-bail run test`, con PostgreSQL de pruebas y S3 simulado.
  - Todo pasa: lint, chequeos, typecheck y build. En pruebas, 1262/1262: contracts 42, delivery 128, geo-kit 39,
    mobile 294 y core 759, incluidas las de volumen y PostGIS.
  - Las 4 pruebas de S3 se repitieron con Node 26 cuando volvió el servidor S3 de pruebas.
  - No apareció ninguna advertencia de deprecación de Node en la salida.
- **Sin probar.**
  - `@types/node` 26: requiere cambiar `package.json` y el lockfile, así que queda para el PR de migración.
  - La imagen Docker con `node:26`: no hay daemon de Docker en este entorno.
  - El empaquetado nativo de EAS.

## 5. Plan de verificación del PR de migración

1. **Local.** `pnpm install --frozen-lockfile` con Node 26 y `pnpm check` completo con base de datos y S3 de pruebas.
2. **CI.** El PR pasa los 7 checks requeridos: `check`, `delivery`, `report-comment`, `supply-chain`, `security`,
   `iac` e `image`. El job `image` construye `core.Dockerfile` con Node 26 y le pasa Trivy (HIGH/CRITICAL con
   arreglo) y el SBOM.
3. **Imagen en local.**
   - `pnpm dzd deploy --env local --image <imagen> --digest <digest> --execute`;
   - `pnpm dzd verify --url http://127.0.0.1:8088 --repeat 5 --slo` (p95 < 300 ms, sin 5xx);
   - `pnpm dzd load` de humo. El worker arranca y `/health/ready` ve su latido.
4. **App.** `pnpm --filter @dizaster/mobile run bundle:check` y `native:check`, que ya corren en CI. Un build de EAS
   solo con el visto bueno del propietario (cupo de EAS = 0 en la política).
5. **Staging.** Cuando exista (D-18/D-23): `deliver.yml` lanzado por el propietario con el digest de `main`. La
   autonomía sigue en 2, así que staging es manual. Después, el SLO de la revisión.
6. **Observación.** 24 a 48 h en staging antes de promover, mirando errores 5xx, latencia, reinicios y memoria (el
   heap por defecto puede cambiar entre versiones mayores).

## 6. Rollback

- **Código.** El PR es uno solo y atómico: `git revert` del merge devuelve `.nvmrc`, `engines`, imágenes y tipos a
  Node 22 juntos, y `check:workflows` lo confirma.
- **Despliegue.** La imagen con Node 22 sigue en el registro por digest. `pnpm dzd rollback --env staging` (o
  `production`) devuelve el 100 % del tráfico a la revisión anterior sin reconstruir nada.
- **Datos.** Ninguno: la migración no toca el esquema ni los datos. No hay `pg_upgrade` ni migraciones SQL.
- **Ventana segura.** Node 22 tiene soporte hasta el 2027-04-30. Si algo falla, se vuelve a 22 y se reintenta con
  la siguiente 26.x.

# ADR 0261 — Google Cloud como destino, entornos, identidades y secretos

- Estado: Aceptado como diseño; crear proyectos y facturación: BLOQUEADO (decisión financiera del propietario)
- Fecha: 2026-09-30
- Relación con el Blueprint: §20.12, §20.13, §20.17, §20.18, §20.22; modifica D-18 (§16) y la fila "Cómputo" de §4.3

## Contexto

El Blueprint recomendaba VPS económicos (D-18) y dejaba AWS/GCP "solo si hay créditos"; D-18 seguía BLOQUEADA
(ADR 0070). La instrucción del propietario del 2026-09-30 pide diseñar inicialmente para Google Cloud: Cloud Run,
Cloud SQL PostgreSQL/PostGIS, Cloud Storage, Artifact Registry, Secret Manager, IAM, Logging y Monitoring, sin
Kubernetes hasta que haga falta. Esta ADR toma esa dirección para el **diseño**; activar proyectos y facturación
sigue siendo decisión del propietario.

## Decisión

### Entornos

| Entorno | Dónde | Autonomía de Claude | Datos |
|---|---|---|---|
| DEVELOPMENT | local / contenedor de trabajo y CI (`docker-compose.yml`, PostGIS de CI) | máxima | sintéticos |
| STAGING | proyecto GCP `dizaster-staging` | despliegue automático tras gates | sintéticos, fixtures geo |
| PRODUCTION | proyecto GCP `dizaster-prod` | ninguna directa; promoción por política | reales |

Proyectos separados: identidades, secretos, presupuestos y registros de auditoría distintos. Ninguna identidad de
staging puede tocar producción.

### Servicios

- **Cloud Run:** servicio `api` y servicio `worker` (misma imagen; `WORKER_ROLES`). API con escala a cero en staging;
  en producción, mínimo 1 instancia solo si la latencia del carril urgente lo exige (decisión de costo).
  El worker necesita CPU siempre asignada o un `Cloud Run job` programado para `maintenance`: se evaluará en la
  implementación.
- **Base de datos:** Cloud SQL para PostgreSQL con PostGIS. **Riesgo a verificar antes de elegir:** el código usa la
  extensión `h3` de PostgreSQL (h3-pg) en consultas y en una migración; no consta que Cloud SQL la soporte. Si no la
  soporta: (a) PostgreSQL propio con `infra/docker/db.Dockerfile` en Compute Engine con discos persistentes y
  respaldos, o (b) mover esos cálculos H3 a la aplicación (`packages/geo-kit` ya tiene H3). Se decide al implementar,
  con prueba real.
- **Cloud Storage:** media y tiles (hoy S3-compatible por interfaz; se usa el endpoint S3/XML de GCS o un driver GCS
  detrás de la misma interfaz). El Blueprint prefería almacenamiento sin costo de egreso (R2): el egreso de media es
  el mayor costo variable; se mantiene la interfaz para poder usar R2 si conviene.
- **Artifact Registry:** imágenes por digest. **Secret Manager:** secretos por entorno. **Cloud Logging / Trace /
  Monitoring:** destino de OpenTelemetry y logs existentes.

### Identidades (mínimo privilegio)

| Cuenta de servicio | Proyecto | Permisos | Quién la usa |
|---|---|---|---|
| `dz-ci` | ambos | escribir imágenes en Artifact Registry | GitHub Actions en `main` |
| `dz-deploy-staging` | staging | desplegar revisiones Cloud Run, correr migraciones | GitHub Actions, entorno `staging` |
| `dz-deploy-prod` | prod | igual, solo en prod | GitHub Actions, entorno `production`, tras política |
| `dz-run-api`, `dz-run-worker` | cada uno | leer sus secretos, su bucket, conectar a su base | Cloud Run |
| `dz-migrate` | cada uno | DDL en su base, sin borrar la base | job de migraciones |
| `dz-backup` | prod | exportar respaldos a un bucket de otro proyecto/proveedor con retención | job de respaldo |

- Autenticación desde GitHub por **Workload Identity Federation** (OIDC), condicionada a repositorio, rama/etiqueta y
  entorno. Sin claves JSON de cuentas de servicio.
- Nada de roles primitivos (Owner/Editor) en automatización. El rol Owner del proyecto queda solo en la cuenta del
  propietario, con MFA.
- Claude no tiene identidad en Google Cloud.

### Secretos

Secret Manager por entorno: `AUTH_JWT_SECRET`, `FIELD_KEYS`, `DATABASE_URL`, `S3_*`/credenciales de almacenamiento,
`APNS_PRIVATE_KEY`, `FCM_SERVICE_ACCOUNT_JSON`, `SOURCE_KEY_*`, `SOURCE_PUSH_SECRET_*`. Cloud Run los monta como
variables. Rotación según `docs/runbooks/rotacion-de-claves.md`. `EXPO_TOKEN` sigue en GitHub/EAS (ADR 0218).

### Capas gratuitas (a verificar al activar; "gratis" no es ilimitado)

Según la documentación pública conocida a 2026, sujeta a cambio y a región:

- Cloud Run: ~2 millones de solicitudes, 180 000 vCPU-s y 360 000 GiB-s al mes.
- Artifact Registry: ~0,5 GB de almacenamiento.
- Secret Manager: ~6 versiones activas y ~10 000 accesos al mes.
- Cloud Logging: ~50 GiB de ingesta por proyecto y mes.
- Cloud Storage: ~5 GB en regiones de EE. UU. solamente (la capa gratuita no aplica en Sudamérica).
- Compute Engine: 1 e2-micro en ciertas regiones de EE. UU.
- **Cloud SQL no tiene capa gratuita:** es el principal costo fijo (una instancia por entorno). Presupuestos y alertas
  de facturación: sin costo.
- GitHub Actions: sin límite en repositorios públicos; ~2 000 minutos/mes en privados con plan gratuito.
- Latencia a Perú: la región más cercana es Santiago (`southamerica-west1`); las capas gratuitas de EE. UU. no
  aplican allí. Elegir región es parte de la decisión de costo.

### Decisiones pendientes del propietario (no se asumen)

- **D-18 (actualizada):** Google Cloud como destino queda indicado por el propietario; **crear los proyectos, la
  facturación y el presupuesto mensual** sigue BLOQUEADO hasta su autorización explícita.
- **D-23 (nueva): base de datos de staging.** Opciones: (a) Cloud SQL mínima propia (costo fijo mensual), (b)
  PostgreSQL en e2-micro gratuito en EE. UU. (sin costo, más lento, lejos de Perú), (c) staging efímero que se crea
  para verificar y se apaga (costo por uso, más complejo). Recomendación: **(b)** mientras no haya usuarios.
- **D-24 (nueva): plan de GitHub.** Revisores obligatorios en entornos y algunos escáneres dependen del plan en
  repositorios privados. Recomendación: plan gratuito + promoción a producción solo desde etiqueta del propietario
  (ADR 0262) hasta que haga falta más.

## Consecuencias

- §4.3 (fila Cómputo) y D-18 quedan actualizadas por esta ADR; la portabilidad por contenedores se mantiene, así que
  un VPS sigue siendo posible sin reescribir.
- Hasta que existan el repositorio (D-20) y los proyectos (D-18), todo lo que toque GitHub o Google Cloud está
  BLOQUEADO; el resto (CLI, políticas, IaC validada localmente con `tofu validate`, escáneres) puede avanzar.

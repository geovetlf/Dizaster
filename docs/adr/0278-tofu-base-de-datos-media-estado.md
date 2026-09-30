# ADR 0278 — OpenTofu: base de datos (Cloud SQL o VM propia), bucket de media, bucket de estado y pruebas sin nube

- Estado: Aceptado (código validado y probado con proveedor simulado). Aplicar: BLOCKED_BY_OWNER (D-23 staging) y BLOCKED_BY_BILLING (D-18)
- Fecha: 2026-09-30
- Relación con el Blueprint: §20.17, §20.21; ADR 0261, 0267, 0275, 0277
- IA: **NO AI REQUIRED**. Costo: 0 mientras no se aplique.

## Contexto

La instrucción del 2026-09-30 19:32 pide dejar la IaC lista y validada también para PostgreSQL, almacenamiento y el
estado de OpenTofu. ADR 0261/0267 los habían dejado fuera: la base espera D-23 y el riesgo de que Cloud SQL no ofrezca
la extensión `h3`.

## Decisión

- `stack.database.mode` (sin valor por defecto; decide el propietario):
  - `cloudsql` — módulo `database-cloudsql`: PostgreSQL 16, protección contra borrado, respaldos diarios y PITR
    configurables, conexión solo por el conector de Cloud SQL (IP pública sin redes autorizadas, `ENCRYPTED_ONLY`,
    `roles/cloudsql.client` para API, worker y migraciones), montado en `/cloudsql`. Registros del motor sin
    sentencias ni parámetros.
  - `vm` — módulo `database-vm`: la misma imagen que desarrollo y CI (`infra/docker/db.Dockerfile`, PostGIS y H3
    garantizados) en Container-Optimized OS, sin IP pública, disco de datos aparte con `prevent_destroy`, VPC propia
    con Private Google Access, PostgreSQL solo desde la subred, SSH solo por IAP con OS Login y sin claves del
    proyecto, Secure Boot. Cloud Run llega por Direct VPC egress. La contraseña se lee de Secret Manager al arrancar
    y queda en un archivo en memoria.
  - `external` — ningún recurso: `DATABASE_URL` apunta a otro proveedor.
- `media_bucket` opcional (módulo `media`): GCS por su API S3, acceso uniforme, lectura pública solo si
  `public_read`, limpieza de subidas multiparte abandonadas. Un `check` exige que sea el mismo bucket de `storage`.
- `infra/tofu/bootstrap`: el bucket de estado (versionado, sin acceso público, `prevent_destroy`), aplicado una vez por
  el propietario con estado local. `dz-deploy` solo escribe bajo `delivery/<entorno>/` (condición de IAM) para el
  historial del Delivery Plane (ADR 0277).
- Ningún secreto pasa por OpenTofu: ni la contraseña de la base ni las claves HMAC de media, porque quedarían en el
  estado. Las crea el propietario con `gcloud` directo a Secret Manager.
- **Pruebas sin nube:** `infra/tofu/modules/stack/tests/stack.tftest.hcl` (`tofu test` con proveedor simulado, solo
  `plan`): cableado de los tres modos, validaciones de `database`, imagen por digest y el `check` de media. CI lo
  corre en el job `iac`, junto a `validate` del bootstrap.
- La prueba encontró un error real: el id `dz-ci` tiene 5 caracteres y Google exige entre 6 y 30. La cuenta pasa a
  llamarse `dz-ci-images` (ADR 0261 y 0275 la nombran con el nombre anterior).
- Trivy (misconfig) sin HIGH ni CRITICAL. GCP-0017 (IP pública de Cloud SQL) queda ignorado con justificación en el
  código. Hallazgos MEDIUM y LOW aceptados por costo: registros de flujo de la subred (se facturan) y claves de
  cifrado propias (CMEK).

## Consecuencias

- Elegir `cloudsql` exige confirmar antes la extensión `h3` en Cloud SQL (ADR 0261). Si no está, se usa `vm`.
- El tipo de máquina, el tamaño, los respaldos y la región son decisiones de costo del propietario: los ejemplos de
  tfvars los dejan como marcadores `<…>` y `dzd env-check` falla mientras falten.

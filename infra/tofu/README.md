# Infraestructura de Google Cloud en OpenTofu (ADR 0261, 0267)

Código solamente: **nada de esto se ha aplicado** ni se aplica sin autorización del propietario (D-18 proyectos y
facturación, D-23 base de staging). CI solo corre `tofu fmt`, `tofu validate`, `dzd iac-check` y Trivy.

| Módulo | Qué crea |
| --- | --- |
| `project-base` | APIs y cuentas `dz-ci`, `dz-deploy`, `dz-run-api`, `dz-run-worker`, `dz-migrate`, `dz-backup`; IAM mínimo |
| `github-wif` | pool y proveedor OIDC de GitHub limitado al repositorio: `dz-ci` desde `main`, `dz-deploy` desde el entorno |
| `backups` | bucket de respaldos (otro proyecto si se quiere), versionado, retención, `dz-backup` solo escribe |
| `monitoring` | chequeo externo de `/health` y alerta por correo |
| `budget` | presupuesto mensual con avisos al 50, 90 y 100 % |
| `artifact-registry` | repositorio Docker con etiquetas inmutables y limpieza de versiones viejas |
| `secrets` | contenedores de Secret Manager, sin valores; lectura solo para identidades de ejecución |
| `cloud-run-api` | API pública (imagen por digest, probes `/health`, escala sin valores por defecto) |
| `cloud-run-worker` | worker pool (sin HTTP; salud por latido en la base) |
| `cloud-run-job` | job de migraciones con `dz-migrate` |
| `stack` | compone todo un entorno |

Fuera a propósito: la base de datos (D-23 y verificación de H3 en Cloud SQL, ADR 0261), el bucket de media (GCS o
R2, decisión de costo) y el bucket de estado de OpenTofu (lo crea el propietario al activar el proyecto).

Flujo cuando exista autorización:

```sh
cd infra/tofu/envs/staging
cp staging.tfvars.example staging.tfvars      # valores del propietario; ignorado por git
tofu init -backend-config="bucket=<bucket de estado>"
tofu plan -var-file=staging.tfvars -out=plan && tofu show -json plan > plan.json
pnpm dzd iac-check --plan plan.json          # block detiene; approval espera al propietario
# apply: solo con autorización (apply-infra-production es OWNER_ONLY; destroy nunca es automático)
```

Recursos con datos (`google_artifact_registry_repository`, `google_secret_manager_secret`) llevan
`prevent_destroy`, y los servicios de Cloud Run `deletion_protection`.

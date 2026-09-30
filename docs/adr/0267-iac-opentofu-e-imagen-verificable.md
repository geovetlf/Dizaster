# ADR 0267 — IaC en OpenTofu validada sin aplicar e imagen del backend verificable en CI

- Estado: Aceptado (código); aplicar en Google Cloud: BLOCKED_BY_OWNER / BLOCKED_BY_BILLING (D-18, D-23)
- Fecha: 2026-09-30
- Relación con el Blueprint: §20.11 (artefactos), §20.12, §20.17, §20.22 (IaC); ADR 0187, 0261, 0262, 0265, 0266
- IA: **NO AI REQUIRED**. Costo: 0 (nada se crea en la nube).

## Contexto

La fase D0 del plano de entrega pedía IaC validada sin credenciales y un build de imagen con manifiesto y SBOM. ADR
0261 eligió OpenTofu y fijó entornos, identidades y secretos.

## Decisión

### `infra/tofu/`

- Módulos `project-base`, `github-wif`, `artifact-registry`, `secrets`, `cloud-run-api`, `cloud-run-worker`,
  `cloud-run-job` y `stack`; raíces `envs/staging` y `envs/production` con backend `gcs` de configuración parcial.
- Proveedor `hashicorp/google ~> 7.46`. Validado con `tofu validate` contra el esquema real del proveedor 7.46.1 y
  OpenTofu 1.13.0 (compilados desde sus etiquetas oficiales porque el registro no es alcanzable desde el entorno de
  desarrollo). El `.terraform.lock.hcl` no se versiona hasta el primer `init` en CI, para que registre los hashes de los
  binarios oficiales y no los de esa compilación local.
- El worker corre como **worker pool** de Cloud Run: no escucha HTTP (`dist/worker.js`), así que un servicio exigiría
  un puerto. Su salud sigue siendo el latido en la base (ADR 0187).
- Sin valores por defecto para proyecto, región, instancias mínimas/máximas del API, instancias del worker ni
  almacenamiento: son decisiones de costo del propietario. Los `*.tfvars.example` solo tienen marcadores.
- Secretos: OpenTofu crea el contenedor y el acceso; nunca el valor (no queda en el estado).
- `prevent_destroy` en registro y secretos, `deletion_protection` en Cloud Run, imagen solo por digest (validación
  de variable) y tráfico/imagen fuera del control de OpenTofu (`ignore_changes`): los mueve `dzd` con despliegue
  gradual y rollback.
- `delivery/policy.json` añade a la lista sin costo los tres tipos de IAM por recurso que usan los módulos.

### Imagen

- `.dockerignore` nuevo: el contexto ya no incluye `node_modules`, `.git`, `.env*`, estado de OpenTofu ni artefactos.
- `core.Dockerfile` borra npm, npx, corepack y yarn de la imagen final: Trivy encontró avisos HIGH con arreglo solo en
  dependencias internas de npm (brace-expansion, ip-address, pacote, picomatch, sigstore). La imagen solo ejecuta
  `node`. Tras el cambio: 0 HIGH/CRITICAL con arreglo disponible (prueba local con Trivy 0.74.0), usuario `node`.
- Job `image` en CI (tras `check` y `security`): build OCI con buildx, digest del manifiesto OCI, Trivy de la imagen
  (`--ignore-unfixed`, falla en HIGH/CRITICAL), SBOM CycloneDX de la imagen, `dzd artifact` con `--image-digest` y
  `dzd artifact verify`. No se sube a ningún registro hasta D-18 y D1. La firma con cosign sin claves (OIDC de GitHub)
  se añade cuando exista el repositorio (D1).
- Job `iac` en CI: `tofu fmt -check`, `tofu validate` en ambos entornos y `dzd iac-check --hcl`.
- Dependabot: `terraform` en ambos entornos y `docker` en `infra/docker`, mensual.

## Consecuencias

- Activar staging es: el propietario crea proyecto, facturación y bucket de estado (D-18), decide la base (D-23),
  completa `staging.tfvars`, y `tofu plan` pasa por `dzd iac-check` antes de cualquier `apply` autorizado.
- Hasta entonces, cada cambio de IaC o de la imagen se valida igual en CI, sin costo.

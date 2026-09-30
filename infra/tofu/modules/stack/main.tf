# Un entorno completo de Dizaster en su propio proyecto (ADR 0261): identidades, WIF, registro, secretos, API, worker
# y job de migraciones. La base de datos NO está aquí: staging espera D-23 y producción depende de verificar H3 en
# Cloud SQL (ADR 0261); DATABASE_URL llega como secreto.

variable "project_id" { type = string }
variable "region" { type = string }
variable "environment" { type = string }
variable "github_repository" { type = string }
variable "image" {
  type        = string
  description = "Digest inicial; los siguientes los despliega dzd."
  validation {
    condition     = can(regex("@sha256:[0-9a-f]{64}$", var.image))
    error_message = "La imagen se despliega por digest, nunca por etiqueta."
  }
}
variable "api_min_instances" { type = number }
variable "api_max_instances" { type = number }
variable "worker_instances" { type = number }
variable "public_api_url" { type = string }
variable "storage" {
  type = object({
    endpoint        = string
    bucket          = string
    public_base_url = string
  })
  description = "Almacenamiento S3-compatible de media (GCS por XML/HMAC o R2: decisión de costo, ADR 0261)."
}
variable "backup" {
  type = object({
    project_id     = string
    location       = string
    bucket_name    = string
    retention_days = number
  })
  description = "Dónde y cuánto se guardan los respaldos (idealmente otro proyecto). Decisión del propietario."
}
variable "alert_email" { type = string }
variable "billing" {
  type = object({
    account        = string
    currency_code  = string
    monthly_amount = number
  })
  description = "Cuenta de facturación y presupuesto mensual del entorno (D-18)."
}
variable "database" {
  type = object({
    mode = string
    cloudsql = optional(object({
      tier                   = string
      edition                = string
      disk_size_gb           = number
      availability_type      = string
      backup_start_time      = string
      retained_backups       = number
      point_in_time_recovery = bool
    }))
    vm = optional(object({
      zone         = string
      machine_type = string
      disk_size_gb = number
      image        = string
      subnet_cidr  = string
    }))
  })
  description = "Base de datos (D-23 en staging): cloudsql, vm (imagen propia con PostGIS y H3) o external (otro proveedor; solo DATABASE_URL)."
  validation {
    condition     = contains(["cloudsql", "vm", "external"], var.database.mode) && (var.database.mode != "cloudsql" || var.database.cloudsql != null) && (var.database.mode != "vm" || var.database.vm != null)
    error_message = "database.mode es cloudsql, vm o external, y cloudsql/vm llevan su bloque de configuración."
  }
}
variable "media_bucket" {
  type = object({
    location    = string
    bucket_name = string
    public_read = bool
  })
  description = "Bucket de media en GCS (ADR 0278). null si la media va a R2 u otro S3 (decisión de costo)."
  default     = null
}
variable "delivery_state_bucket" {
  type        = string
  description = "Bucket creado por infra/tofu/bootstrap: estado de OpenTofu e historial del Delivery Plane."
}
variable "registry_readers" {
  type        = list(string)
  description = "Solo staging: la cuenta dz-deploy de producción, que lee de aquí el digest que promueve (ADR 0277)."
  default     = []
}
variable "extra_env" {
  type        = map(string)
  description = "Configuración no secreta (APNS_TEAM_ID, APNS_KEY_ID, APNS_BUNDLE_ID, STORE_URL_*, MAP_*, …)."
  default     = {}
}

locals {
  # Nombres de secreto de ADR 0261. Los valores los carga el propietario; OpenTofu nunca los ve.
  runtime_secrets = {
    DATABASE_URL             = "database-url"
    AUTH_JWT_SECRET          = "auth-jwt-secret"
    FIELD_KEYS               = "field-keys"
    S3_ACCESS_KEY_ID         = "s3-access-key-id"
    S3_SECRET_ACCESS_KEY     = "s3-secret-access-key"
    APNS_PRIVATE_KEY         = "apns-private-key"
    FCM_SERVICE_ACCOUNT_JSON = "fcm-service-account-json"
  }
  # Lo que loadEnv exige en producción (services/core/src/platform/config.ts): s3, push real, sin proveedores de prueba.
  common_env = merge(var.extra_env, {
    NODE_ENV              = "production"
    PUBLIC_API_URL        = var.public_api_url
    TRUST_PROXY           = "true"
    STORAGE_DRIVER        = "s3"
    S3_ENDPOINT           = var.storage.endpoint
    S3_BUCKET             = var.storage.bucket
    MEDIA_PUBLIC_BASE_URL = var.storage.public_base_url
    PUSH_DRIVER           = "live"
    OTEL_SERVICE_NAME     = "dizaster-core"
  })
  # Solo con la base en VM: la contraseña que la VM lee al arrancar (DATABASE_URL la incluye, cargada a mano).
  secret_names = concat(values(local.runtime_secrets), var.database.mode == "vm" ? ["database-password"] : [])
  sa           = module.base.service_accounts
  member       = { for k, email in local.sa : k => "serviceAccount:${email}" }
}

module "base" {
  source      = "../project-base"
  project_id  = var.project_id
  environment = var.environment
}

module "wif" {
  source                 = "../github-wif"
  project_id             = var.project_id
  github_repository      = var.github_repository
  github_environment     = var.environment
  ci_service_account     = "projects/${var.project_id}/serviceAccounts/${local.sa["dz-ci-images"]}"
  deploy_service_account = "projects/${var.project_id}/serviceAccounts/${local.sa["dz-deploy"]}"
}

module "registry" {
  source        = "../artifact-registry"
  project_id    = var.project_id
  region        = var.region
  pusher_member = local.member["dz-ci-images"]
  # Producción no construye: recibe por copia el mismo digest firmado que pasó staging.
  promotion_writers = var.environment == "production" ? [local.member["dz-deploy"]] : []
  readers           = var.registry_readers
}

module "secrets" {
  source     = "../secrets"
  project_id = var.project_id
  names      = local.secret_names
  readers = merge(
    { for env_name, id in local.runtime_secrets : id => [local.member["dz-run-api"], local.member["dz-run-worker"]] if env_name != "DATABASE_URL" },
    { "database-url" = [local.member["dz-run-api"], local.member["dz-run-worker"], local.member["dz-migrate"]] },
  )
}

module "db_cloudsql" {
  count                  = var.database.mode == "cloudsql" ? 1 : 0
  source                 = "../database-cloudsql"
  project_id             = var.project_id
  region                 = var.region
  instance_name          = "dizaster-${var.environment}"
  tier                   = var.database.cloudsql.tier
  edition                = var.database.cloudsql.edition
  disk_size_gb           = var.database.cloudsql.disk_size_gb
  availability_type      = var.database.cloudsql.availability_type
  backup_start_time      = var.database.cloudsql.backup_start_time
  retained_backups       = var.database.cloudsql.retained_backups
  point_in_time_recovery = var.database.cloudsql.point_in_time_recovery
  client_members         = [local.member["dz-run-api"], local.member["dz-run-worker"], local.member["dz-migrate"]]
}

module "db_vm" {
  count               = var.database.mode == "vm" ? 1 : 0
  source              = "../database-vm"
  project_id          = var.project_id
  region              = var.region
  zone                = var.database.vm.zone
  machine_type        = var.database.vm.machine_type
  disk_size_gb        = var.database.vm.disk_size_gb
  image               = var.database.vm.image
  subnet_cidr         = var.database.vm.subnet_cidr
  password_secret_id  = "projects/${var.project_id}/secrets/${module.secrets.ids["database-password"]}"
  registry_repository = module.registry.name
}

locals {
  cloudsql_instances = var.database.mode == "cloudsql" ? [module.db_cloudsql[0].connection_name] : []
  vpc                = var.database.mode == "vm" ? { network = module.db_vm[0].network, subnetwork = module.db_vm[0].subnetwork } : null
}

module "media" {
  count       = var.media_bucket == null ? 0 : 1
  source      = "../media"
  project_id  = var.project_id
  location    = var.media_bucket.location
  bucket_name = var.media_bucket.bucket_name
  public_read = var.media_bucket.public_read
  # La clave HMAC de S3 es de dz-run-api; el worker usa la misma (ADR 0278).
  writers = [local.member["dz-run-api"], local.member["dz-run-worker"]]
}

check "media_bucket_es_el_de_storage" {
  assert {
    condition     = var.media_bucket == null || var.storage.bucket == try(var.media_bucket.bucket_name, "")
    error_message = "storage.bucket debe ser el mismo bucket que media_bucket.bucket_name."
  }
}

# dz-deploy guarda el historial de versiones y la auditoría del Delivery Plane, solo bajo delivery/<entorno>/.
resource "google_storage_bucket_iam_member" "delivery_state" {
  bucket = var.delivery_state_bucket
  role   = "roles/storage.objectUser"
  member = local.member["dz-deploy"]
  condition {
    title      = "solo-delivery-${var.environment}"
    expression = "resource.name.startsWith(\"projects/_/buckets/${var.delivery_state_bucket}/objects/delivery/${var.environment}/\")"
  }
}

module "api" {
  source             = "../cloud-run-api"
  project_id         = var.project_id
  region             = var.region
  name               = "api"
  image              = var.image
  service_account    = local.sa["dz-run-api"]
  min_instances      = var.api_min_instances
  max_instances      = var.api_max_instances
  env                = local.common_env
  secret_env         = { for k, v in local.runtime_secrets : k => module.secrets.ids[v] }
  cloudsql_instances = local.cloudsql_instances
  vpc                = local.vpc
}

module "worker" {
  source             = "../cloud-run-worker"
  project_id         = var.project_id
  region             = var.region
  name               = "worker"
  image              = var.image
  service_account    = local.sa["dz-run-worker"]
  instances          = var.worker_instances
  env                = local.common_env
  secret_env         = { for k, v in local.runtime_secrets : k => module.secrets.ids[v] }
  cloudsql_instances = local.cloudsql_instances
  vpc                = local.vpc
}

module "migrate" {
  source             = "../cloud-run-job"
  project_id         = var.project_id
  region             = var.region
  name               = "migrate"
  image              = var.image
  service_account    = local.sa["dz-migrate"]
  secret_env         = { DATABASE_URL = module.secrets.ids["database-url"] }
  cloudsql_instances = local.cloudsql_instances
  vpc                = local.vpc
}

data "google_project" "this" {
  project_id = var.project_id
}

module "backups" {
  source         = "../backups"
  project_id     = var.backup.project_id
  location       = var.backup.location
  bucket_name    = var.backup.bucket_name
  retention_days = var.backup.retention_days
  writer_member  = local.member["dz-backup"]
}

module "monitoring" {
  source      = "../monitoring"
  project_id  = var.project_id
  api_host    = trimsuffix(trimprefix(var.public_api_url, "https://"), "/")
  alert_email = var.alert_email
}

module "budget" {
  source          = "../budget"
  billing_account = var.billing.account
  project_number  = data.google_project.this.number
  environment     = var.environment
  monthly_amount  = var.billing.monthly_amount
  currency_code   = var.billing.currency_code
}

output "api_uri" { value = module.api.uri }
output "registry" { value = module.registry.repository }
output "wif_provider" { value = module.wif.provider_name }
output "deploy_service_account" { value = local.sa["dz-deploy"] }
output "ci_service_account" { value = local.sa["dz-ci-images"] }
output "backup_bucket" { value = module.backups.bucket }
output "state_bucket" { value = var.delivery_state_bucket }
output "database_connection" {
  value = var.database.mode == "cloudsql" ? module.db_cloudsql[0].connection_name : var.database.mode == "vm" ? module.db_vm[0].host : "external"
}

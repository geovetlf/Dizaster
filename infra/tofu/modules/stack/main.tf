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
  sa     = module.base.service_accounts
  member = { for k, email in local.sa : k => "serviceAccount:${email}" }
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
  deploy_service_account = "projects/${var.project_id}/serviceAccounts/${local.sa["dz-deploy"]}"
}

module "registry" {
  source        = "../artifact-registry"
  project_id    = var.project_id
  region        = var.region
  pusher_member = local.member["dz-deploy"]
}

module "secrets" {
  source     = "../secrets"
  project_id = var.project_id
  names      = values(local.runtime_secrets)
  readers = merge(
    { for env_name, id in local.runtime_secrets : id => [local.member["dz-run-api"], local.member["dz-run-worker"]] if env_name != "DATABASE_URL" },
    { "database-url" = [local.member["dz-run-api"], local.member["dz-run-worker"], local.member["dz-migrate"]] },
  )
}

module "api" {
  source          = "../cloud-run-api"
  project_id      = var.project_id
  region          = var.region
  name            = "api"
  image           = var.image
  service_account = local.sa["dz-run-api"]
  min_instances   = var.api_min_instances
  max_instances   = var.api_max_instances
  env             = local.common_env
  secret_env      = { for k, v in local.runtime_secrets : k => module.secrets.ids[v] }
}

module "worker" {
  source          = "../cloud-run-worker"
  project_id      = var.project_id
  region          = var.region
  name            = "worker"
  image           = var.image
  service_account = local.sa["dz-run-worker"]
  instances       = var.worker_instances
  env             = local.common_env
  secret_env      = { for k, v in local.runtime_secrets : k => module.secrets.ids[v] }
}

module "migrate" {
  source          = "../cloud-run-job"
  project_id      = var.project_id
  region          = var.region
  name            = "migrate"
  image           = var.image
  service_account = local.sa["dz-migrate"]
  secret_env      = { DATABASE_URL = module.secrets.ids["database-url"] }
}

output "api_uri" { value = module.api.uri }
output "registry" { value = module.registry.repository }
output "wif_provider" { value = module.wif.provider_name }
output "deploy_service_account" { value = local.sa["dz-deploy"] }

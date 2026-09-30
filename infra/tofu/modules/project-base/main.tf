# APIs y cuentas de servicio de un proyecto de entorno (ADR 0261). Sin roles primitivos (owner/editor/viewer).

variable "project_id" { type = string }
variable "environment" {
  type = string
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment es staging o production."
  }
}

locals {
  apis = [
    "run.googleapis.com",
    "artifactregistry.googleapis.com",
    "secretmanager.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "sts.googleapis.com",
    "monitoring.googleapis.com",
    "billingbudgets.googleapis.com",
  ]
  # Cuentas de ejecución, CI, despliegue y respaldo (ADR 0261, 0275). Cada una hace una sola cosa.
  accounts = {
    "dz-ci"         = "Sube imágenes al registro desde main (${var.environment})"
    "dz-backup"     = "Escribe respaldos; no puede borrarlos"
    "dz-deploy"     = "Despliega revisiones de Cloud Run (${var.environment})"
    "dz-run-api"    = "Identidad de ejecución de la API"
    "dz-run-worker" = "Identidad de ejecución del worker"
    "dz-migrate"    = "Job de migraciones de base de datos"
  }
}

resource "google_project_service" "api" {
  for_each           = toset(local.apis)
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_service_account" "sa" {
  for_each     = local.accounts
  project      = var.project_id
  account_id   = each.key
  display_name = each.value
  depends_on   = [google_project_service.api]
}

# dz-deploy despliega en Cloud Run y actúa como las identidades de ejecución, nada más.
resource "google_project_iam_member" "deploy_run" {
  project = var.project_id
  role    = "roles/run.developer"
  member  = "serviceAccount:${google_service_account.sa["dz-deploy"].email}"
}

resource "google_service_account_iam_member" "deploy_acts_as" {
  for_each           = toset(["dz-run-api", "dz-run-worker", "dz-migrate"])
  service_account_id = google_service_account.sa[each.value].name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.sa["dz-deploy"].email}"
}

# Telemetría de las identidades de ejecución (OpenTelemetry → Cloud Trace, logs y métricas).
resource "google_project_iam_member" "runtime_telemetry" {
  for_each = {
    for pair in setproduct(["dz-run-api", "dz-run-worker", "dz-migrate"], ["roles/logging.logWriter", "roles/cloudtrace.agent", "roles/monitoring.metricWriter"]) :
    "${pair[0]}/${pair[1]}" => { account = pair[0], role = pair[1] }
  }
  project = var.project_id
  role    = each.value.role
  member  = "serviceAccount:${google_service_account.sa[each.value.account].email}"
}

output "service_accounts" {
  value = { for k, sa in google_service_account.sa : k => sa.email }
}

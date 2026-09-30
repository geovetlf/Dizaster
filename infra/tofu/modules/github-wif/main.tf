# GitHub Actions → Google Cloud por Workload Identity Federation (OIDC), sin claves JSON (ADR 0261).
# Solo el repositorio indicado, y solo desde su entorno de GitHub (staging o production), puede tomar cada identidad.

variable "project_id" { type = string }
variable "github_repository" {
  type        = string
  description = "owner/repo del repositorio de Dizaster (D-20)."
  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.github_repository))
    error_message = "github_repository tiene la forma owner/repo."
  }
}
variable "github_environment" {
  type        = string
  description = "Entorno de GitHub con permiso para desplegar (staging o production)."
}
variable "deploy_service_account" {
  type        = string
  description = "Nombre completo (projects/…/serviceAccounts/…) de la cuenta que se puede tomar."
}

resource "google_iam_workload_identity_pool" "github" {
  project                   = var.project_id
  workload_identity_pool_id = "github"
  display_name              = "GitHub Actions"
}

resource "google_iam_workload_identity_pool_provider" "github" {
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-oidc"
  display_name                       = "GitHub OIDC"
  attribute_mapping = {
    "google.subject"        = "assertion.sub"
    "attribute.repository"  = "assertion.repository"
    "attribute.environment" = "assertion.environment"
    "attribute.ref"         = "assertion.ref"
  }
  # Ningún otro repositorio puede presentar tokens a este pool.
  attribute_condition = "assertion.repository == \"${var.github_repository}\""
  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

# Sujeto de GitHub para un job con `environment:`: repo:OWNER/REPO:environment:NOMBRE.
resource "google_service_account_iam_member" "deploy" {
  service_account_id = var.deploy_service_account
  role               = "roles/iam.workloadIdentityUser"
  member             = "principal://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/subject/repo:${var.github_repository}:environment:${var.github_environment}"
}

output "provider_name" { value = google_iam_workload_identity_pool_provider.github.name }

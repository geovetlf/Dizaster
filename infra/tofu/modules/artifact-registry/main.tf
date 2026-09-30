# Registro de imágenes (ADR 0261): inmutable por etiqueta, se despliega por digest y se limpian las imágenes viejas
# para no pasar de la capa gratuita de almacenamiento.

variable "project_id" { type = string }
variable "region" { type = string }
variable "keep_recent" {
  type        = number
  description = "Versiones recientes que se conservan (rollback posible hasta esa profundidad)."
  default     = 10
}
variable "pusher_member" {
  type        = string
  description = "Principal que puede subir imágenes (identidad de CI por WIF)."
}

resource "google_artifact_registry_repository" "images" {
  project       = var.project_id
  location      = var.region
  repository_id = "dizaster"
  format        = "DOCKER"
  description   = "Imágenes de Dizaster (API y worker)"

  docker_config {
    immutable_tags = true
  }

  cleanup_policy_dry_run = false
  cleanup_policies {
    id     = "conservar-recientes"
    action = "KEEP"
    most_recent_versions {
      keep_count = var.keep_recent
    }
  }
  cleanup_policies {
    id     = "borrar-sin-etiqueta-viejas"
    action = "DELETE"
    condition {
      tag_state  = "UNTAGGED"
      older_than = "2592000s"
    }
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_artifact_registry_repository_iam_member" "pusher" {
  project    = var.project_id
  location   = google_artifact_registry_repository.images.location
  repository = google_artifact_registry_repository.images.name
  role       = "roles/artifactregistry.writer"
  member     = var.pusher_member
}

output "repository" {
  value = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images.repository_id}"
}

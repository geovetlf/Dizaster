# La API en Cloud Run con la imagen única del backend (ADR 0187, 0261). El worker va en un worker pool y las
# migraciones en un job, con la misma imagen.
# La imagen se fija por digest; el Delivery Plane (`dzd`, ADR 0265) mueve el tráfico entre revisiones y hace rollback.
# Las cifras de escala no tienen valor por defecto: son decisiones de costo del propietario (D-18).

variable "project_id" { type = string }
variable "region" { type = string }
variable "name" { type = string }
variable "image" {
  type        = string
  description = "Imagen por digest: REGION-docker.pkg.dev/PROYECTO/dizaster/core@sha256:…"
  validation {
    condition     = can(regex("@sha256:[0-9a-f]{64}$", var.image))
    error_message = "La imagen se despliega por digest, nunca por etiqueta."
  }
}
variable "service_account" { type = string }
variable "env" {
  type    = map(string)
  default = {}
}
variable "secret_env" {
  type        = map(string)
  description = "Variable de entorno → id del secreto en Secret Manager (siempre la versión latest)."
  default     = {}
}
variable "min_instances" { type = number }
variable "max_instances" { type = number }

resource "google_cloud_run_v2_service" "svc" {
  project             = var.project_id
  location            = var.region
  name                = var.name
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = true

  template {
    service_account = var.service_account
    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }
    containers {
      image = var.image
      ports {
        container_port = 8080
      }
      resources {
        cpu_idle = true
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }
      dynamic "env" {
        for_each = var.env
        content {
          name  = env.key
          value = env.value
        }
      }
      dynamic "env" {
        for_each = var.secret_env
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value
              version = "latest"
            }
          }
        }
      }
      startup_probe {
        http_get {
          path = "/health"
        }
        period_seconds    = 5
        failure_threshold = 12
      }
      liveness_probe {
        http_get {
          path = "/health"
        }
        period_seconds = 30
      }
    }
  }

  # El tráfico lo mueve `dzd` (despliegue gradual y rollback); OpenTofu no lo revierte en cada plan.
  lifecycle {
    ignore_changes = [traffic, template[0].containers[0].image, client, client_version]
  }
}

# dzd:allow-public — la API es pública para la app móvil; la autorización la hace la propia API (JWT, ADR 0011).
resource "google_cloud_run_v2_service_iam_member" "public" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.svc.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

output "uri" { value = google_cloud_run_v2_service.svc.uri }
output "name" { value = google_cloud_run_v2_service.svc.name }

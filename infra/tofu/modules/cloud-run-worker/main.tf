# El worker (outbox, ingesta, notificaciones, mantenimiento: WORKER_ROLES) en un worker pool de Cloud Run: procesa sin
# solicitudes HTTP, así que no necesita puerto ni probes; su salud es el latido en la base (`worker-health-cli`,
# ADR 0187). El número de instancias es decisión de costo del propietario (D-18): sin valor por defecto.

variable "project_id" { type = string }
variable "region" { type = string }
variable "name" { type = string }
variable "image" {
  type = string
  validation {
    condition     = can(regex("@sha256:[0-9a-f]{64}$", var.image))
    error_message = "La imagen se despliega por digest, nunca por etiqueta."
  }
}
variable "service_account" { type = string }
variable "instances" { type = number }
variable "env" {
  type    = map(string)
  default = {}
}
variable "secret_env" {
  type    = map(string)
  default = {}
}

resource "google_cloud_run_v2_worker_pool" "pool" {
  project             = var.project_id
  location            = var.region
  name                = var.name
  deletion_protection = true

  scaling {
    manual_instance_count = var.instances
  }

  template {
    service_account = var.service_account
    containers {
      image   = var.image
      command = ["node", "--import", "./dist/telemetry.js", "dist/worker.js"]
      resources {
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
    }
  }

  lifecycle {
    ignore_changes = [template[0].containers[0].image, client, client_version]
  }
}

output "name" { value = google_cloud_run_v2_worker_pool.pool.name }

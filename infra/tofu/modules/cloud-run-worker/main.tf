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

variable "cloudsql_instances" {
  type        = list(string)
  description = "Conexiones de Cloud SQL (proyecto:región:instancia) montadas en /cloudsql (ADR 0278)."
  default     = []
}
variable "vpc" {
  type = object({
    network    = string
    subnetwork = string
  })
  description = "Red privada para llegar a la base en VM (Direct VPC egress, ADR 0278). null si no hace falta."
  default     = null
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
    dynamic "vpc_access" {
      for_each = var.vpc == null ? [] : [var.vpc]
      content {
        egress = "PRIVATE_RANGES_ONLY"
        network_interfaces {
          network    = vpc_access.value.network
          subnetwork = vpc_access.value.subnetwork
        }
      }
    }
    dynamic "volumes" {
      for_each = length(var.cloudsql_instances) > 0 ? [1] : []
      content {
        name = "cloudsql"
        cloud_sql_instance {
          instances = var.cloudsql_instances
        }
      }
    }
    containers {
      image   = var.image
      command = ["node", "--import", "./dist/telemetry.js", "dist/worker.js"]
      dynamic "volume_mounts" {
        for_each = length(var.cloudsql_instances) > 0 ? [1] : []
        content {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }
      }
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

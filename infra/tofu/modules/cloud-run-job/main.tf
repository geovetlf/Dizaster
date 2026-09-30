# Migraciones como job de Cloud Run (ADR 0261): corre la imagen del mismo digest que se va a desplegar, antes del
# despliegue, con la identidad dz-migrate. Solo cuesta mientras corre. En producción lo dispara la política
# (migrate-production es OWNER_ONLY en `dzd autonomy`, ADR 0262).

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

resource "google_cloud_run_v2_job" "job" {
  project             = var.project_id
  location            = var.region
  name                = var.name
  deletion_protection = true

  template {
    task_count = 1
    template {
      service_account = var.service_account
      max_retries     = 0
      timeout         = "900s"
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
        command = ["node", "dist/migrate-cli.js"]
        dynamic "volume_mounts" {
          for_each = length(var.cloudsql_instances) > 0 ? [1] : []
          content {
            name       = "cloudsql"
            mount_path = "/cloudsql"
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
  }

  lifecycle {
    ignore_changes = [template[0].template[0].containers[0].image, client, client_version]
  }
}

output "name" { value = google_cloud_run_v2_job.job.name }

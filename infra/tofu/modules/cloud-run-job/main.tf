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
      containers {
        image   = var.image
        command = ["node", "dist/migrate-cli.js"]
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

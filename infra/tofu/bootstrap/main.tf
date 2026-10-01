# Arranque único (ADR 0278): el bucket donde vive el estado de OpenTofu de staging y production y el historial del
# Delivery Plane (`delivery/<entorno>/`). Se aplica una vez, a mano, por el propietario, con estado local (este
# directorio no tiene backend remoto porque el bucket todavía no existe). Después:
#   tofu init -backend-config="bucket=<bucket_name>"   en infra/tofu/envs/staging y envs/production.
# El archivo terraform.tfstate que queda aquí es pequeño; se guarda con los respaldos (no va a git).

terraform {
  required_version = ">= 1.8"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 8.4"
    }
  }
}

provider "google" {
  project = var.project_id
}

variable "project_id" {
  type        = string
  description = "Proyecto que guarda el estado (idealmente uno de administración, distinto de staging y production)."
}
variable "location" { type = string }
variable "bucket_name" { type = string }
variable "noncurrent_versions_kept" {
  type        = number
  description = "Versiones anteriores del estado que se conservan (recuperación ante un apply equivocado)."
}

resource "google_storage_bucket" "state" {
  project                     = var.project_id
  name                        = var.bucket_name
  location                    = var.location
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  versioning {
    enabled = true
  }

  lifecycle_rule {
    condition {
      num_newer_versions = var.noncurrent_versions_kept
      with_state         = "ARCHIVED"
    }
    action {
      type = "Delete"
    }
  }

  lifecycle {
    prevent_destroy = true
  }
}

output "bucket" { value = google_storage_bucket.state.name }

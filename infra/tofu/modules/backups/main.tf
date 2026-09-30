# Bucket de respaldos de la base (ADR 0275, runbook respaldo-y-restauracion). Puede vivir en otro proyecto para que
# un error o una credencial comprometida del entorno no alcance los respaldos. dz-backup solo crea objetos: no lee,
# no reemplaza, no borra. La retención no se bloquea aquí (bloquearla es irreversible: decisión del propietario).

variable "project_id" { type = string }
variable "location" { type = string }
variable "bucket_name" { type = string }
variable "retention_days" {
  type        = number
  description = "Días que cada respaldo no se puede borrar ni sobrescribir; después se borra solo. Decisión del propietario."
}
variable "writer_member" { type = string }

resource "google_storage_bucket" "backups" {
  project                     = var.project_id
  name                        = var.bucket_name
  location                    = var.location
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  versioning {
    enabled = true
  }
  retention_policy {
    retention_period = var.retention_days * 86400
    is_locked        = false
  }
  lifecycle_rule {
    condition {
      age = var.retention_days + 1
    }
    action {
      type = "Delete"
    }
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_storage_bucket_iam_member" "writer" {
  bucket = google_storage_bucket.backups.name
  role   = "roles/storage.objectCreator"
  member = var.writer_member
}

output "bucket" { value = google_storage_bucket.backups.name }

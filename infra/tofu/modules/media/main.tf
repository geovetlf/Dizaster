# Bucket de media en Google Cloud Storage (ADR 0278), accedido por la API compatible con S3 (STORAGE_DRIVER=s3,
# endpoint https://storage.googleapis.com). Opcional: si el propietario elige R2 u otro S3 (decisión de costo, ADR
# 0261), este módulo no se usa. Las claves HMAC NO se crean aquí (quedarían en el estado): el propietario las crea con
# gcloud para dz-run-api y las guarda en Secret Manager (docs/runbooks/activacion-bloqueos.md).

variable "project_id" { type = string }
variable "location" { type = string }
variable "bucket_name" { type = string }
variable "public_read" {
  type        = bool
  description = "true si MEDIA_PUBLIC_BASE_URL sirve directo desde el bucket. La media pública ya está moderada y sin EXIF (ADR 0036)."
}
variable "writers" {
  type        = list(string)
  description = "Identidades que suben y borran media (API y worker: la moderación retira contenido)."
}

resource "google_storage_bucket" "media" {
  project                     = var.project_id
  name                        = var.bucket_name
  location                    = var.location
  uniform_bucket_level_access = true
  public_access_prevention    = var.public_read ? "inherited" : "enforced"

  # Subidas multiparte abandonadas: se limpian (ocupan espacio y no se ven).
  lifecycle_rule {
    condition {
      age = 1
    }
    action {
      type = "AbortIncompleteMultipartUpload"
    }
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_storage_bucket_iam_member" "writers" {
  for_each = toset(var.writers)
  bucket   = google_storage_bucket.media.name
  role     = "roles/storage.objectAdmin"
  member   = each.value
}

# dzd:allow-public — solo con public_read: lectura de objetos ya moderados, sin listado del bucket.
resource "google_storage_bucket_iam_member" "public" {
  count  = var.public_read ? 1 : 0
  bucket = google_storage_bucket.media.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}

output "bucket" { value = google_storage_bucket.media.name }

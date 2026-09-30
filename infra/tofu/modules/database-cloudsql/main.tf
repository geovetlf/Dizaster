# PostgreSQL gestionado en Cloud SQL (ADR 0278). Una de las dos opciones de D-23; la otra es `database-vm`.
# Sin valores por defecto de tamaño, edición ni respaldos: son decisiones de costo del propietario.
# Riesgo abierto (ADR 0261): confirmar que Cloud SQL ofrece la extensión `h3` en la versión elegida antes de aplicar;
# si no, se usa `database-vm` con la imagen propia (infra/docker/db.Dockerfile), que ya la trae.
# La contraseña del usuario de la aplicación NUNCA pasa por OpenTofu (quedaría en el estado): la crea el propietario
# con gcloud y va directa a Secret Manager (docs/runbooks/activacion-bloqueos.md).

variable "project_id" { type = string }
variable "region" { type = string }
variable "instance_name" { type = string }
variable "tier" {
  type        = string
  description = "Tipo de máquina de Cloud SQL (p. ej. db-f1-micro o db-custom-1-3840). Decisión de costo."
}
variable "edition" {
  type = string
  validation {
    condition     = contains(["ENTERPRISE", "ENTERPRISE_PLUS"], var.edition)
    error_message = "edition es ENTERPRISE o ENTERPRISE_PLUS."
  }
}
variable "disk_size_gb" { type = number }
variable "availability_type" {
  type = string
  validation {
    condition     = contains(["ZONAL", "REGIONAL"], var.availability_type)
    error_message = "availability_type es ZONAL o REGIONAL."
  }
}
variable "backup_start_time" {
  type        = string
  description = "Hora UTC HH:MM del respaldo automático diario."
}
variable "retained_backups" { type = number }
variable "point_in_time_recovery" { type = bool }
variable "client_members" {
  type        = list(string)
  description = "Identidades que se conectan por el conector de Cloud SQL (API, worker, migraciones)."
}

resource "google_project_service" "sqladmin" {
  project            = var.project_id
  service            = "sqladmin.googleapis.com"
  disable_on_destroy = false
}

# IP pública sin redes autorizadas: solo el conector de Cloud SQL (IAM) entra; la IP privada exigiría VPC y
# Service Networking solo para esto. Revisado en ADR 0278.
#trivy:ignore:GCP-0017
resource "google_sql_database_instance" "db" {
  project             = var.project_id
  region              = var.region
  name                = var.instance_name
  database_version    = "POSTGRES_16"
  deletion_protection = true

  settings {
    tier                        = var.tier
    edition                     = var.edition
    availability_type           = var.availability_type
    disk_size                   = var.disk_size_gb
    disk_autoresize             = false
    deletion_protection_enabled = true

    # IP pública SIN redes autorizadas: solo entra el conector de Cloud SQL, que exige IAM (roles/cloudsql.client).
    ip_configuration {
      ipv4_enabled = true
      ssl_mode     = "ENCRYPTED_ONLY"
    }

    backup_configuration {
      enabled                        = true
      start_time                     = var.backup_start_time
      point_in_time_recovery_enabled = var.point_in_time_recovery
      backup_retention_settings {
        retained_backups = var.retained_backups
      }
    }

    # Registros operativos del motor (sin parámetros de consultas: no se registran sentencias).
    dynamic "database_flags" {
      for_each = { log_connections = "on", log_disconnections = "on", log_lock_waits = "on", log_checkpoints = "on", log_temp_files = "0" }
      content {
        name  = database_flags.key
        value = database_flags.value
      }
    }
  }

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [google_project_service.sqladmin]
}

resource "google_sql_database" "dizaster" {
  project  = var.project_id
  instance = google_sql_database_instance.db.name
  name     = "dizaster"

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_project_iam_member" "client" {
  for_each = toset(var.client_members)
  project  = var.project_id
  role     = "roles/cloudsql.client"
  member   = each.value
}

output "connection_name" { value = google_sql_database_instance.db.connection_name }

# PostgreSQL + PostGIS + H3 en una VM pequeña propia (ADR 0278). La otra opción de D-23 frente a `database-cloudsql`:
# usa la misma imagen que desarrollo y CI (infra/docker/db.Dockerfile, con H3 garantizado) y la más barata en cómputo,
# a cambio de operarla (parches del sistema los aplica Container-Optimized OS; respaldos con scripts/db-backup.sh).
# Sin IP pública: solo la alcanzan la API, el worker y el job de migraciones por la red privada (Direct VPC egress),
# y la administración entra por IAP. El disco de datos es un recurso aparte con prevent_destroy: reemplazar la VM no
# toca los datos. La contraseña vive en Secret Manager; OpenTofu solo conoce su nombre.

variable "project_id" { type = string }
variable "region" { type = string }
variable "zone" { type = string }
variable "machine_type" {
  type        = string
  description = "p. ej. e2-micro o e2-small. Decisión de costo del propietario (verificar la capa gratuita vigente)."
}
variable "disk_size_gb" { type = number }
variable "image" {
  type        = string
  description = "Imagen de base de datos por digest (…/dizaster/db@sha256:…), construida desde infra/docker/db.Dockerfile."
  validation {
    condition     = can(regex("@sha256:[0-9a-f]{64}$", var.image))
    error_message = "La imagen de base de datos se fija por digest."
  }
}
variable "subnet_cidr" {
  type        = string
  description = "Rango de la subred privada (p. ej. 10.20.0.0/24)."
}
variable "password_secret_id" {
  type        = string
  description = "Id completo del secreto con la contraseña del superusuario (projects/…/secrets/…)."
}
variable "registry_repository" {
  type        = string
  description = "Nombre del repositorio de Artifact Registry del que la VM lee la imagen."
}

locals {
  data_disk = "dizaster-pgdata"
}

resource "google_project_service" "compute" {
  project            = var.project_id
  service            = "compute.googleapis.com"
  disable_on_destroy = false
}

resource "google_compute_network" "vpc" {
  project                 = var.project_id
  name                    = "dizaster"
  auto_create_subnetworks = false
  depends_on              = [google_project_service.compute]
}

# Private Google Access: la VM sin IP pública descarga la imagen y lee el secreto por las APIs de Google.
resource "google_compute_subnetwork" "private" {
  project                  = var.project_id
  region                   = var.region
  name                     = "dizaster-private"
  network                  = google_compute_network.vpc.id
  ip_cidr_range            = var.subnet_cidr
  private_ip_google_access = true
}

# PostgreSQL solo desde la subred (Cloud Run sale por ella con Direct VPC egress).
resource "google_compute_firewall" "postgres" {
  project       = var.project_id
  name          = "dizaster-postgres-from-subnet"
  network       = google_compute_network.vpc.id
  direction     = "INGRESS"
  source_ranges = [var.subnet_cidr]
  target_tags   = ["dz-db"]
  allow {
    protocol = "tcp"
    ports    = ["5432"]
  }
}

# Administración solo por IAP (rango fijo publicado por Google para IAP TCP forwarding).
resource "google_compute_firewall" "iap_ssh" {
  project       = var.project_id
  name          = "dizaster-ssh-from-iap"
  network       = google_compute_network.vpc.id
  direction     = "INGRESS"
  source_ranges = ["35.235.240.0/20"]
  target_tags   = ["dz-db"]
  allow {
    protocol = "tcp"
    ports    = ["22"]
  }
}

resource "google_service_account" "db" {
  project      = var.project_id
  account_id   = "dz-database"
  display_name = "VM de base de datos: lee su imagen y su contraseña, escribe logs"
}

resource "google_project_iam_member" "db_logs" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.db.email}"
}

resource "google_artifact_registry_repository_iam_member" "db_pull" {
  project    = var.project_id
  location   = var.region
  repository = var.registry_repository
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:${google_service_account.db.email}"
}

resource "google_secret_manager_secret_iam_member" "db_password" {
  project   = var.project_id
  secret_id = var.password_secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.db.email}"
}

resource "google_compute_disk" "data" {
  project = var.project_id
  zone    = var.zone
  name    = local.data_disk
  type    = "pd-balanced"
  size    = var.disk_size_gb

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_compute_instance" "db" {
  project                   = var.project_id
  zone                      = var.zone
  name                      = "dizaster-db"
  machine_type              = var.machine_type
  tags                      = ["dz-db"]
  deletion_protection       = true
  allow_stopping_for_update = true

  boot_disk {
    initialize_params {
      image = "projects/cos-cloud/global/images/family/cos-stable"
    }
  }

  attached_disk {
    source      = google_compute_disk.data.id
    device_name = local.data_disk
  }

  # Sin access_config: sin IP pública.
  network_interface {
    subnetwork = google_compute_subnetwork.private.id
  }

  shielded_instance_config {
    enable_secure_boot          = true
    enable_vtpm                 = true
    enable_integrity_monitoring = true
  }

  service_account {
    email  = google_service_account.db.email
    scopes = ["cloud-platform"]
  }

  metadata = {
    enable-oslogin         = "TRUE"
    block-project-ssh-keys = "TRUE"
    startup-script = templatefile("${path.module}/startup.sh.tftpl", {
      disk     = local.data_disk
      image    = var.image
      registry = split("/", var.image)[0]
      secret   = var.password_secret_id
    })
  }
}

output "host" { value = google_compute_instance.db.network_interface[0].network_ip }
output "network" { value = google_compute_network.vpc.id }
output "subnetwork" { value = google_compute_subnetwork.private.id }

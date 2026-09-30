# Contenedores de secretos por entorno (ADR 0261). Solo se crea el nombre: ningún valor vive en OpenTofu ni en su
# estado. El propietario carga cada versión con `gcloud secrets versions add` (runbook de rotación).

variable "project_id" { type = string }
variable "names" { type = list(string) }
variable "readers" {
  type        = map(list(string))
  description = "Secreto → principales que lo leen (solo identidades de ejecución)."
  default     = {}
}

resource "google_secret_manager_secret" "s" {
  for_each  = toset(var.names)
  project   = var.project_id
  secret_id = each.value
  replication {
    auto {}
  }
  lifecycle {
    prevent_destroy = true
  }
}

resource "google_secret_manager_secret_iam_member" "reader" {
  for_each = {
    for pair in flatten([for s, members in var.readers : [for m in members : { secret = s, member = m }]]) :
    "${pair.secret}/${pair.member}" => pair
  }
  project   = var.project_id
  secret_id = google_secret_manager_secret.s[each.value.secret].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = each.value.member
}

output "ids" { value = { for k, s in google_secret_manager_secret.s : k => s.secret_id } }

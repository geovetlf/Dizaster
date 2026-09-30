# Vigilancia externa de la API (ADR 0275, Blueprint §20.21): un chequeo de disponibilidad desde fuera sobre /health y
# una alerta por correo al propietario si falla. La salud interna (worker, cola) ya la da /health/ready.

variable "project_id" { type = string }
variable "api_host" {
  type        = string
  description = "Host público de la API, sin https:// (p. ej. el de PUBLIC_API_URL)."
}
variable "alert_email" {
  type        = string
  description = "Correo que recibe las alertas (del propietario o su guardia)."
}

resource "google_monitoring_notification_channel" "email" {
  project      = var.project_id
  display_name = "Dizaster: guardia"
  type         = "email"
  labels = {
    email_address = var.alert_email
  }
}

resource "google_monitoring_uptime_check_config" "api" {
  project      = var.project_id
  display_name = "API /health"
  timeout      = "10s"
  period       = "300s"

  http_check {
    path         = "/health"
    port         = 443
    use_ssl      = true
    validate_ssl = true
  }
  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = var.project_id
      host       = var.api_host
    }
  }
}

resource "google_monitoring_alert_policy" "api_down" {
  project      = var.project_id
  display_name = "API caída (/health)"
  combiner     = "OR"
  conditions {
    display_name = "El chequeo de disponibilidad falla"
    condition_threshold {
      filter          = "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND resource.type=\"uptime_url\" AND metric.label.check_id=\"${google_monitoring_uptime_check_config.api.uptime_check_id}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 1
      duration        = "600s"
      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_NEXT_OLDER"
        cross_series_reducer = "REDUCE_COUNT_FALSE"
        group_by_fields      = ["resource.label.project_id"]
      }
    }
  }
  notification_channels = [google_monitoring_notification_channel.email.id]
  documentation {
    content   = "Ver docs/runbooks/respuesta-a-incidentes.md y, si fue tras un despliegue, `pnpm dzd rollback`."
    mime_type = "text/markdown"
  }
}

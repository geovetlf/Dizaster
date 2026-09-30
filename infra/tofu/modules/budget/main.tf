# Presupuesto y alertas de facturación del proyecto (ADR 0275, Blueprint §20.19). El presupuesto no corta el gasto:
# avisa. El corte lo hacen los kill switches del producto (ADR 0138). Monto y cuenta los decide el propietario.

variable "billing_account" {
  type        = string
  description = "Id de la cuenta de facturación (XXXXXX-XXXXXX-XXXXXX)."
}
variable "project_number" { type = string }
variable "environment" { type = string }
variable "monthly_amount" {
  type        = number
  description = "Presupuesto mensual en unidades de la moneda de la cuenta. Sin valor por defecto: decisión del propietario (D-18)."
}
variable "currency_code" { type = string }

resource "google_billing_budget" "monthly" {
  billing_account = var.billing_account
  display_name    = "Dizaster ${var.environment}"

  budget_filter {
    projects = ["projects/${var.project_number}"]
  }
  amount {
    specified_amount {
      currency_code = var.currency_code
      units         = tostring(floor(var.monthly_amount))
    }
  }
  threshold_rules {
    threshold_percent = 0.5
  }
  threshold_rules {
    threshold_percent = 0.9
  }
  threshold_rules {
    threshold_percent = 1.0
  }
  threshold_rules {
    threshold_percent = 1.0
    spend_basis       = "FORECASTED_SPEND"
  }
}

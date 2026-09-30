# Entorno production (ADR 0261). Sin valores por defecto: el proyecto, la región, la escala y el almacenamiento son
# decisiones del propietario (D-18). Nada de esto se aplica sin su autorización.
#
#   tofu init -backend-config="bucket=<bucket de estado>"   # el bucket de estado lo crea el propietario
#   tofu plan -var-file=production.tfvars -out=plan && tofu show -json plan > plan.json
#   pnpm dzd iac-check --plan plan.json                        # block detiene; approval espera al propietario

terraform {
  required_version = ">= 1.8"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.46"
    }
  }
  backend "gcs" {
    prefix = "dizaster/production"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

variable "project_id" { type = string }
variable "region" { type = string }
variable "github_repository" { type = string }
variable "image" { type = string }
variable "api_min_instances" { type = number }
variable "api_max_instances" { type = number }
variable "worker_instances" { type = number }
variable "public_api_url" { type = string }
variable "storage" {
  type = object({
    endpoint        = string
    bucket          = string
    public_base_url = string
  })
}
variable "extra_env" {
  type    = map(string)
  default = {}
}

module "stack" {
  source            = "../../modules/stack"
  environment       = "production"
  project_id        = var.project_id
  region            = var.region
  github_repository = var.github_repository
  image             = var.image
  api_min_instances = var.api_min_instances
  api_max_instances = var.api_max_instances
  worker_instances  = var.worker_instances
  public_api_url    = var.public_api_url
  storage           = var.storage
  extra_env         = var.extra_env
}

output "api_uri" { value = module.stack.api_uri }
output "registry" { value = module.stack.registry }
output "wif_provider" { value = module.stack.wif_provider }
output "deploy_service_account" { value = module.stack.deploy_service_account }

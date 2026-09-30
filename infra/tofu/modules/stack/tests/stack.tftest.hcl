# Pruebas del stack sin nube ni credenciales (ADR 0278): proveedor simulado, solo `plan`. Comprueban el cableado de
# módulos y las validaciones de variables con valores ficticios; nunca se aplican.
mock_provider "google" {
  mock_data "google_project" {
    defaults = { number = "123456789012" }
  }
}

# El simulador daría el mismo correo a todas las cuentas; se fijan como las crearía project-base.
override_module {
  target = module.base
  outputs = {
    service_accounts = {
      "dz-ci-images"  = "dz-ci-images@dz-test-staging.iam.gserviceaccount.com"
      "dz-deploy"     = "dz-deploy@dz-test-staging.iam.gserviceaccount.com"
      "dz-run-api"    = "dz-run-api@dz-test-staging.iam.gserviceaccount.com"
      "dz-run-worker" = "dz-run-worker@dz-test-staging.iam.gserviceaccount.com"
      "dz-migrate"    = "dz-migrate@dz-test-staging.iam.gserviceaccount.com"
      "dz-backup"     = "dz-backup@dz-test-staging.iam.gserviceaccount.com"
    }
  }
}

variables {
  project_id            = "dz-test-staging"
  region                = "southamerica-west1"
  environment           = "staging"
  github_repository     = "dizaster-org/dizaster"
  image                 = "southamerica-west1-docker.pkg.dev/dz-test-staging/dizaster/core@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  api_min_instances     = 0
  api_max_instances     = 1
  worker_instances      = 1
  public_api_url        = "https://api.test.invalid"
  storage               = { endpoint = "https://storage.googleapis.com", bucket = "dz-test-media", public_base_url = "https://media.test.invalid" }
  backup                = { project_id = "dz-test-backup", location = "southamerica-west1", bucket_name = "dz-test-backups", retention_days = 30 }
  alert_email           = "ops@test.invalid"
  billing               = { account = "000000-000000-000000", currency_code = "USD", monthly_amount = 10 }
  delivery_state_bucket = "dz-test-state"
  database              = { mode = "external" }
}

run "externa_sin_recursos_de_base" {
  command = plan
  assert {
    condition     = length(module.db_cloudsql) == 0 && length(module.db_vm) == 0 && length(module.media) == 0
    error_message = "con mode external no se crea base ni bucket de media"
  }
  assert {
    condition     = local.vpc == null && length(local.cloudsql_instances) == 0
    error_message = "sin base propia, Cloud Run no se conecta a ninguna red ni instancia"
  }
  assert {
    condition     = !contains(local.secret_names, "database-password")
    error_message = "la contraseña de la VM solo existe con mode vm"
  }
}

run "cloud_sql_conectado_por_conector" {
  command = plan
  variables {
    database = {
      mode     = "cloudsql"
      cloudsql = { tier = "db-f1-micro", edition = "ENTERPRISE", disk_size_gb = 10, availability_type = "ZONAL", backup_start_time = "07:00", retained_backups = 7, point_in_time_recovery = false }
    }
  }
  assert {
    condition     = length(module.db_cloudsql) == 1 && length(module.db_vm) == 0
    error_message = "mode cloudsql crea solo la instancia de Cloud SQL"
  }
  assert {
    condition     = length(local.cloudsql_instances) == 1
    error_message = "API, worker y migraciones montan el conector"
  }
}

run "vm_privada_con_su_secreto" {
  command = plan
  variables {
    database = {
      mode = "vm"
      vm   = { zone = "southamerica-west1-a", machine_type = "e2-micro", disk_size_gb = 20, subnet_cidr = "10.20.0.0/24", image = "southamerica-west1-docker.pkg.dev/dz-test-staging/dizaster/db@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }
    }
  }
  assert {
    condition     = length(module.db_vm) == 1 && local.vpc != null
    error_message = "mode vm crea la VM y Cloud Run sale por la red privada"
  }
  assert {
    condition     = contains(local.secret_names, "database-password")
    error_message = "mode vm crea el contenedor del secreto de la contraseña"
  }
}

run "modo_desconocido_rechazado" {
  command = plan
  variables {
    database = { mode = "sqlite" }
  }
  expect_failures = [var.database]
}

run "cloudsql_sin_configuracion_rechazado" {
  command = plan
  variables {
    database = { mode = "cloudsql" }
  }
  expect_failures = [var.database]
}

run "imagen_por_etiqueta_rechazada" {
  command = plan
  variables {
    image = "southamerica-west1-docker.pkg.dev/dz-test-staging/dizaster/core:latest"
  }
  expect_failures = [var.image]
}

run "media_en_gcs_debe_ser_el_bucket_de_storage" {
  command = plan
  variables {
    media_bucket = { location = "southamerica-west1", bucket_name = "otro-bucket", public_read = true }
  }
  expect_failures = [check.media_bucket_es_el_de_storage]
}

run "media_en_gcs" {
  command = plan
  variables {
    media_bucket = { location = "southamerica-west1", bucket_name = "dz-test-media", public_read = false }
  }
  assert {
    condition     = length(module.media) == 1
    error_message = "con media_bucket se crea el bucket"
  }
}

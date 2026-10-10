# Activación de cada bloqueo externo

Un procedimiento exacto por bloqueo. Cada uno dice qué falta, por qué, qué está listo y qué pasos hace el propietario
y cuáles el agente. **El propietario** hace solo lo que exige su cuenta, su dinero o una decisión legal. **El agente**
hace todo lo demás, sin credenciales maestras.

Orden recomendado: 1 → 2 → 3 → 4 → 5. El resto no depende del orden.

---

## 1. Reglas de `main` y entornos (GitHub)

- **Aplicado** por el propietario el 2026-10-08. El agente verificó `main` por la API (ADR 0303, "Aplicación").
- **Falta (opcional):** importar `.github/rulesets/tags.json` en Settings → Rules → Rulesets → Import a ruleset. Hace
  inmutables las etiquetas `v*` y no bloquea nada hasta la primera versión.
- **Cómo se verifica en cada entrega:** el job `guard` de `deliver.yml` (`dzd github-guard`, ADR 0303 y 0306) exige:
  - que la entrega se lance desde `main`;
  - que `main` exija PR y los 7 checks, sin force push y sin borrado;
  - que `staging` exista con "Deployment branches: Protected branches only";
  - que `production` tenga a `geovetlf` en "Required reviewers", "Protected branches only" y la casilla "Allow
    administrators to bypass configured protection rules" **desmarcada**.

  Si algo falta, la entrega se detiene con el motivo ("incorrecto"). Si la API no responde, también se detiene ("no
  verificable"). Desde la sesión del agente los entornos no se pueden leer: su estado figura como no verificado hasta la
  primera ejecución de `deliver.yml`.
- **Propietario, si la primera entrega se detiene por un entorno:** abrir Settings → Environments, corregir lo que diga
  el mensaje y volver a lanzar la entrega.
- El agente fusiona solo con `squash`, con los 7 checks en verde.

## 2. EXPO_TOKEN (primer build de iOS y Android)

- **Falta:** una cuenta gratuita de Expo y un token de acceso.
- **Por qué:** en este entorno no se puede descargar el Android SDK. EAS Build compila en la nube para las dos
  plataformas.
- **Listo:**
  - `.github/workflows/mobile-build.yml`, que es manual para no gastar cupo;
  - `eas.json`;
  - `expo prebuild` verificado.
- **Propietario:**
  1. Crear una cuenta en expo.dev.
  2. Ir a Account settings → Access tokens → crear token.
  3. En GitHub → Settings → Secrets and variables → Actions:
     - secreto `EXPO_TOKEN`;
     - variable `DIZASTER_EXPO_OWNER` = usuario de Expo.
- **Agente:**
  1. `eas init`, que guarda `DIZASTER_EAS_PROJECT_ID`.
  2. Lanzar `mobile-build` con el perfil `preview` para Android y entregar el enlace del APK.
- **Verificación:** el APK se instala en el Android del propietario.
- **Desbloquea:**
  - video 720p en Android;
  - atestación real (punto 7);
  - push real (punto 9).

## 3. Proyectos de Google Cloud, facturación y presupuesto (D-18)

- **Falta:**
  - dos proyectos (staging y production), idealmente más uno de administración para el estado;
  - una cuenta de facturación;
  - el monto del presupuesto mensual.
- **Listo:**
  - `infra/tofu/` validado y probado con `tofu test`;
  - el módulo `budget` avisa al 50, 90 y 100 % del presupuesto;
  - el Delivery Plane en seco.
- **Propietario:**
  1. Crear los proyectos y vincularles la facturación.
  2. Decidir la región y el presupuesto mensual por entorno.
  3. Darle al agente un rol limitado solo en los proyectos de Dizaster, nunca el de la organización ni el de
     facturación. Sugerido para planificar: `roles/viewer` más `roles/iam.securityReviewer`.
  4. `apply` lo ejecuta el propietario, o autoriza por escrito cada `apply` que haga el agente.
- **Agente:**
  1. Completar los `*.tfvars` con los valores del propietario.
  2. `pnpm dzd env-check --env staging --tfvars … --other-tfvars …`.
  3. En `infra/tofu/bootstrap`, `tofu plan` del bucket de estado. El propietario lo aplica una vez.
  4. En cada entorno: `tofu init -backend-config="bucket=<estado>"`, luego `tofu plan -out plan`, luego
     `pnpm dzd iac-check --plan plan.json`, y entregar el plan al propietario.
  5. Después del apply: `node scripts/github-bootstrap.mjs … --outputs outputs.json --execute` para cargar las
     variables de Actions.
- **Verificación:**
  - CI publica y firma la imagen en `main`;
  - `deliver` en staging queda en verde.

## 4. Base de staging (D-23)

- **Falta:** elegir `database.mode`:
  - `cloudsql` (gestionado);
  - `vm` (imagen propia con PostGIS y H3, la de menor cómputo);
  - `external` (otro proveedor).
- **Por qué:** es costo y operación.
- **Dato verificado el 2026-10-10 (ADR 0308):** Cloud SQL **no** admite la extensión `h3`, que usan la migración 0001
  y los módulos de reportes, eventos y media. Con el código actual, `cloudsql` no arranca. Quedan `vm` (recomendado:
  la misma imagen que CI) o `external` con H3, o bien `cloudsql` después de mover H3 a la aplicación (otro ADR).
- **Listo:** los módulos `database-cloudsql` y `database-vm` (ADR 0278), migraciones hasta la 0105 con candado y
  checksum, y respaldo cifrado con `age`.
- **Propietario:**
  1. Elegir el modo, el tamaño y la retención de respaldos.
  2. Crear la contraseña sin que pase por OpenTofu:
     - modo `vm`: `openssl rand -base64 32 | gcloud secrets versions add database-password --data-file=-`;
     - modo `cloudsql`: `gcloud sql users create dizaster --instance=dizaster-staging --password=…`.
  3. Guardar la URL en el secreto `database-url`:
     - modo `vm`: `postgres://dizaster:<clave>@<database_connection>:5432/dizaster`;
     - modo `cloudsql`: `postgres://dizaster:<clave>@/dizaster?host=/cloudsql/<database_connection>`.
- **Agente:**
  1. Solo en modo `vm`: construir y firmar la imagen `db` desde `infra/docker/db.Dockerfile`.
  2. Con `cloudsql`: no aplicar hasta que exista el ADR que mueve H3 a la aplicación.
  3. Ejecutar el job `migrate`.
  4. `pnpm dzd verify --url … --slo`.
- **Verificación:** `/health/ready` da 200 y el mapa responde con PostGIS.

## 5. Media (almacenamiento S3 compatible)

- **Falta:** elegir entre GCS (módulo `media`) y R2 u otro S3, y crear las claves de acceso.
- **Propietario, si elige GCS:**
  1. `gcloud storage hmac create dz-run-api@<proyecto>.iam.gserviceaccount.com`.
  2. Guardar el id en el secreto `s3-access-key-id` y la clave en `s3-secret-access-key`.
- **Agente:**
  1. En tfvars: `storage.endpoint = "https://storage.googleapis.com"` y `media_bucket`.
  2. Verificar la subida y la lectura de una foto de prueba en staging.

## 6. Proveedor de correo de inicio de sesión (ADR 0170)

- **Falta:** que el propietario elija el proveedor. Hoy `EMAIL_PROVIDER` solo admite `none` y `log`, y producción
  rechaza `log`.
- **Listo:** la interfaz `EmailSender`, el flujo de código de un solo uso y sus límites por hora (ADR 0170).
- **Propietario:**
  1. Elegir el proveedor y su plan.
  2. Verificar el dominio de envío (registros DNS).
  3. Cargar la clave en Secret Manager (`email-api-key`).
- **Agente:**
  1. Escribir el adapter con pruebas sobre un doble del proveedor, sin llamadas reales.
  2. Agregar el valor al enum y el secreto a `runtime_secrets`.
  3. Enviar un correo de prueba en staging a la dirección del propietario.

## 7. Verificador real de atestación (App Attest y Play Integrity, ADR 0129)

- **Falta:** el primer build (punto 2), la cuenta de Apple Developer (US$99 al año) y un proyecto de Google Cloud con
  la API de Play Integrity.
- **Por qué:** producción no arranca sin un verificador real (`container.ts`).
- **Listo:** la interfaz `AttestationVerifier`, el verificador de desarrollo y la validación de configuración.
- **Propietario:**
  1. Crear la cuenta de Apple Developer.
  2. En Play Console, vincular el proyecto de Google Cloud.
- **Agente:**
  1. Implementar los dos verificadores con vectores de prueba grabados de un dispositivo real.
  2. Activarlos por configuración y probar en staging.

## 8. Detección de CSAM (ADR 0145) — revisión legal

- **Falta:** asesoría legal sobre las obligaciones de reporte en el Perú y en cada país, y elegir el proveedor de
  hashes.
- **Listo:** el punto de enganche en la moderación de media y la cola de revisión. No se envía nada a terceros.
- **Propietario:**
  1. Conseguir la asesoría legal.
  2. Elegir el proveedor y firmar su acuerdo.
- **Agente:** escribir el adapter detrás de la interfaz y el procedimiento de reporte que defina la asesoría.

## 9. Push real (APNs y FCM)

- **Falta:** la clave APNs `.p8` (Apple Developer) y la cuenta de servicio de Firebase.
- **Propietario:**
  1. Crear la clave APNs.
  2. Crear el proyecto de Firebase y generar la cuenta de servicio.
  3. Cargar en Secret Manager:
     - `apns-private-key`;
     - `fcm-service-account-json`;
     - `APNS_TEAM_ID` y `APNS_KEY_ID`, que van en `extra_env`.
- **Agente:** con `PUSH_DRIVER=live` en staging, enviar un push de prueba a los dispositivos del propietario.

## 10. Fuentes oficiales del piloto (IGP, INDECI, SENAMHI)

- **Falta:** validar los feeds y sus términos de uso.
- **Listo:** el motor de ingesta, `sources.json` y el registro de fuentes oficiales por país, categoría y
  jurisdicción (ADR 0095 y 0109).
- **Propietario:** confirmar el permiso de uso de cada fuente, o el contacto institucional.
- **Agente:**
  1. Escribir un adapter por fuente, con fixtures grabados.
  2. Registrarlas como `OFFICIAL` solo después de la confirmación del propietario.

## 11. Otros bloqueos registrados

Están en `docs/IMPLEMENTATION_STATUS.md` → "Bloqueadas o en espera":

- contacto del cliente de ingesta: el propietario da un correo o URL y se fija `INGEST_CONTACT` en `extra_env` de cada entorno (ADR 0307);
- textos legales;
- revisión de las traducciones al portugués y al francés;
- organizaciones para donar;
- proveedor de IA y su presupuesto (apagado por diseño: nada lo requiere).

En cada caso el código ya funciona sin ese proveedor y se activa por configuración.

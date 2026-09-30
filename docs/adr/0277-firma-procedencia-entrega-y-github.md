# ADR 0277 — Firma keyless, procedencia SLSA, SLO, validación de entornos, flujo de entrega y conexión con GitHub

- Estado: Aceptado (código y pruebas). Activación: BLOCKED_BY_OWNER (D-24 repositorio) y BLOCKED_BY_BILLING (D-18)
- Fecha: 2026-09-30
- Relación con el Blueprint: §20.7, §20.9, §20.11, §20.13–20.15, §5.22; ADR 0130, 0260–0267, 0272, 0275
- IA: **NO AI REQUIRED**. Costo: 0 (Sigstore público, GitHub Actions y cosign son gratuitos; nada corre hasta D-18).

## Contexto

La instrucción del propietario del 2026-09-30 19:32 pide dejar listo el camino completo
CÓDIGO → CI → PRUEBAS → SEGURIDAD → BUILD → SBOM → FIRMA → ARTEFACTO → STAGING → VERIFICACIÓN → PROMOCIÓN →
PRODUCCIÓN → MONITOREO → ROLLBACK, de forma que producción solo acepte artefactos que pasaron staging con digest
verificable, y que el repositorio remoto se conecte después sin rediseño. Faltaban la firma, la procedencia, el
chequeo de SLO, la validación de entornos, el workflow de entrega y la preparación de GitHub.

## Decisión

- **Firma keyless (cosign + Sigstore).** CI firma la imagen por digest en `main` con la identidad OIDC del workflow;
  no existe clave privada que guardar ni filtrar. `delivery/policy.json → signing` fija la identidad aceptada:
  emisor de GitHub Actions, `signing.repository` (null hasta D-24), workflows y refs permitidas
  (`.github/workflows/ci.yml` en `refs/heads/main`). La política no permite `required: false`, otro emisor, ramas
  arbitrarias ni PR. `dzd signature verify` arma `cosign verify` con esa identidad y además comprueba que lo firmado
  sea exactamente el digest pedido. `--key` (clave local) solo se admite con `--env local`.
- **Procedencia SLSA v1.** `dzd provenance` genera un Statement in-toto v1 determinístico a partir del manifiesto del
  artefacto y del contexto de Actions; CI lo adjunta con `cosign attest --type slsaprovenance1`, junto al SBOM
  CycloneDX (`--type cyclonedx`). `dzd provenance verify` rechaza otro digest, commit, repositorio, workflow, ref o
  pruebas/seguridad sin pasar.
- **`dzd deploy` y `dzd promote` verifican la firma** antes de crear ninguna revisión (en seco imprimen el comando).
  Sin repositorio registrado, `--execute` falla con "Firma no verificable".
- **Quién es humano.** `owners` en la política (logins de GitHub, sin bots). En CI el actor es
  `github:<quien disparó>`; solo un owner cuenta como humano. Cualquier otro actor, incluido Claude, queda sujeto al
  nivel de autonomía (hoy 2: no despliega ni a staging). Dentro de Actions nadie puede declararse `human`.
- **SLO.** `policy.slo`: API p95 < 300 ms (Blueprint §5.22, ADR 0130), mínimo de 20 muestras para juzgar y
  `maxErrorRate: null` (no decidido: se informa, no bloquea). En humo, un 5xx bloquea siempre. `dzd slo` lee un
  resumen de k6 o muestras; `dzd verify --repeat N --slo` lo aplica a la verificación posterior al despliegue.
- **Validación de entorno.** `dzd env-check --env staging --tfvars … --env-file …`: variables obligatorias de
  `infra/tofu/envs/<env>`, marcadores `<…>` sin completar, imagen por digest, URL https, repositorio igual al de la
  política, nada con forma de secreto en tfvars, secretos del runtime como `secret:<id>`, staging y producción en
  proyectos distintos, `NODE_ENV=production` en producción.
- **CI (`image`).** Genera la procedencia siempre. Solo en `main` y con `vars.GCP_WIF_PROVIDER` definido: WIF como
  `dz-ci`, `skopeo copy --all --preserve-digests` al registro de staging, `cosign sign`, dos `cosign attest` y
  `dzd signature verify --attestations --execute`. `id-token: write` solo en ese job.
- **Entrega (`.github/workflows/deliver.yml`, manual).** Staging: digest válido, auditoría íntegra, firma y
  atestaciones, migraciones (job de Cloud Run con la misma imagen), `dzd deploy` gradual con rollback automático,
  worker, SLO; historial y auditoría en el bucket de estado. Producción (opcional, entorno `production` con el
  propietario como revisor obligatorio): `cosign copy` del mismo digest con sus firmas desde el registro de staging
  (sin reconstruir), migraciones, `dzd promote` (exige que el digest esté desplegado en staging y actor owner),
  worker, SLO.
- **IaC.** `artifact-registry` admite `promotion_writers` (producción: su `dz-deploy`) y `readers` (staging:
  `registry_readers`, la `dz-deploy` de producción). Salidas `project_id` y `region` por entorno.
- **GitHub preparado sin repositorio.** `.github/rulesets/main.json` (PR con revisión de CODEOWNERS, último push
  aprobado, historial lineal, sin force-push ni borrado, checks `check`, `delivery`, `supply-chain`, `security`,
  `iac`, `image`), `.github/rulesets/tags.json` (etiquetas `v*` inmutables), `.github/CODEOWNERS.template`,
  `.github/pull_request_template.md` y `scripts/github-bootstrap.mjs` (en seco por defecto; con `--execute`: política
  y CODEOWNERS, push de main y etiquetas sin force, rulesets, entornos y variables desde las salidas de OpenTofu). No
  crea el repositorio ni toca secretos.

## Consecuencias

- Probado localmente de punta a punta con un registro local (`crane registry serve`) y cosign 3.1.3 con clave local:
  firma, dos atestaciones y rechazo de un digest sin firmar. El modo keyless solo puede probarse en GitHub (D-24).
- `gcloud beta run worker-pools update` y la ruta `gs://<estado>/delivery/` se confirman en la primera activación.
- Nada de esto puede saltarse: el workflow no recibe credenciales maestras, `dz-deploy` solo despliega y actúa como
  las identidades de ejecución, y el entorno `production` necesita la aprobación del propietario en GitHub además de
  la comprobación de `owners` en `dzd`.

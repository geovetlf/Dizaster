# Runbook — Delivery Control Plane (`dzd`)

Blueprint §20, ADR 0260–0265. Todo corre sin credenciales, salvo lo marcado como BLOQUEADO.

## Uso diario (local o CI)

```sh
pnpm --filter @dizaster/delivery build
pnpm dzd inspect --worktree        # impacto y riesgo de los cambios sin commitear
pnpm dzd plan --base origin/main   # gates que se van a correr
pnpm dzd run-gates --base origin/main
pnpm dzd policy --env production   # auto / review / approval / block
pnpm dzd autonomy --action merge --outcome auto
```

## Un gate falló

1. `dzd run-gates` imprime el diagnóstico (`dzd diagnose --log archivo` para un log guardado).
2. `infra-runner` (red, disco, runner): un solo reintento. Si repite, es un fallo real.
3. Cualquier otro: se corrige el código. Nunca se desactiva una prueba ni un gate (prohibido en todo nivel, ADR 0262).

## Un escáner de seguridad falló (job `security`, ADR 0266)

- Gitleaks: si es un secreto real, rotarlo primero (lo hace el dueño de la credencial) y luego limpiar; un falso
  positivo se añade a `.gitleaks.toml` con su motivo, nunca desactivando la regla entera.
- Trivy / OSV-Scanner: actualizar la dependencia o la imagen base; si no hay versión corregida, documentar el riesgo
  en un ADR antes de ignorarlo.
- Semgrep (reglas propias): corregir el código. Una excepción lleva `// nosemgrep: <regla>` con el motivo en la línea
  anterior y pasa por revisión.
- Reproducir en local con Docker: las mismas imágenes y digests que `ci.yml`.

## La política bloquea

`block` significa: migración destructiva o editada, destroy o reemplazo de un recurso con datos, rol IAM amplio, o una
regla del propietario. Se rehace el cambio (expand/contract). Una excepción solo la autoriza el propietario por escrito
y queda en la auditoría.

## Verificación y rollback (cuando exista staging: D-18, D-23)

- `dzd verify --url https://<servicio>` comprueba `/health`, `/health/ready` y el contrato.
- El despliegue gradual devuelve solo el tráfico a la revisión anterior si falla la verificación. Manual:
  `gcloud run services update-traffic <servicio> --to-revisions=<revisión-anterior>=100` (con la identidad de
  despliegue del entorno, nunca con credenciales personales en CI).
- La base de datos no se revierte automáticamente: las migraciones son compatibles hacia atrás. Una restauración sigue
  `respaldo-y-restauracion.md` y la autoriza el propietario.

## Desplegar, promover y volver atrás (ADR 0272)

Todo es en seco hasta añadir `--execute` (y eso solo cuando existan los proyectos, D-18):

```sh
pnpm dzd config-check --env-file staging.env          # secretos como secret:<id>
pnpm dzd deploy --env staging --digest sha256:… --project … --region … --image …/dizaster/core --url https://…
pnpm dzd promote --digest sha256:… --project … --region … --image … --url https://…   # mismo digest que staging
pnpm dzd rollback --env production --project … --region …                             # a la versión anterior
pnpm dzd audit stats
```

El rollback solo mueve tráfico. Si la versión nueva incluyó una migración, ver
`docs/runbooks/migracion-fallida.md`.

## Firma, procedencia, SLO y entornos (ADR 0277)

```sh
pnpm dzd env-check --env staging --tfvars infra/tofu/envs/staging/staging.tfvars --env-file staging.env
pnpm dzd signature verify --image REGIÓN-docker.pkg.dev/PROYECTO/dizaster/core --digest sha256:… --attestations --execute
pnpm dzd provenance verify --file core.provenance.json --digest sha256:… --commit <sha>
pnpm dzd verify --url https://… --repeat 5 --slo      # p95 < 300 ms y ningún 5xx
pnpm dzd slo --k6 k6-summary.json                    # tras una prueba de carga
```

- "Firma no verificable: No hay repositorio configurado": falta D-24. Se resuelve con `scripts/github-bootstrap.mjs`.
- "Firma rechazada": la imagen no la firmó `ci.yml` en `main` de este repositorio. No se despliega; se reconstruye
  desde `main`.
- La entrega normal es el workflow `deliver` (manual, con el digest que publicó CI). Producción espera la aprobación
  del propietario en el entorno `production`.

## Ensayo local completo, sin nube (ADR 0282)

El mismo camino que staging (candidata sin tráfico, verificación, 10 %, 100 %, rollback automático) sobre Docker en
esta máquina, con un proxy que reparte el tráfico. Requiere Docker y la base local (`docker compose up db migrate`).

```sh
pnpm dzd local-proxy --port 8088 &                                   # reparte según .dzd/local-state.json
docker run -d --name dz-local-worker --network host --env-file local.env <imagen> node dist/worker.js   # /health/ready
pnpm dzd deploy --env local --digest sha256:<id de la imagen> --env-file local.env --url http://127.0.0.1:8088 --execute
pnpm dzd load --url http://127.0.0.1:8088 --requests 300 --concurrency 10      # carga mínima + SLO
k6 run -e BASE_URL=http://127.0.0.1:8088 --summary-export k6-summary.json infra/load/smoke.js
pnpm dzd slo --k6 k6-summary.json --smoke
pnpm dzd rollback --env local --env-file local.env --execute        # si el contenedor ya no existe, levanta el mismo digest
```

- `local.env` lleva `DATABASE_URL`, `AUTH_JWT_SECRET`, `NODE_ENV=development` y `DEV_AUTH_ENABLED=true`.
- La API limita a 300 peticiones por minuto por IP. Una carga desde una sola máquina recibe 429: `dzd slo` los cuenta
  aparte ("límite por IP") y no como error. Para medir la API y no el límite, en `local.env` (nunca en staging ni en
  producción) se agrega `RATE_LIMIT_PER_MINUTE=100000`.
- La base local tiene pocos datos: las latencias locales sirven para detectar regresiones, no predicen producción.
- El destino local no exige firma keyless (con `--key` la verifica) y no cuenta para promover: `promote` solo acepta
  digests desplegados en staging.

## Auditoría

`dzd audit verify --log delivery-audit.jsonl` confirma que nadie cambió, borró ni reordenó entradas.

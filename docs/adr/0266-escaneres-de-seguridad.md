# ADR 0266 — Escáneres de seguridad open source en CI: Gitleaks, Trivy, OSV-Scanner y Semgrep

- Estado: Aceptado
- Fecha: 2026-09-30
- Relación con el Blueprint: §20.8 (security gates), §13.1 (cadena de suministro); ADR 0070, 0264, 0265
- IA: **NO AI REQUIRED**. Costo: 0 (herramientas open source en los runners gratuitos de GitHub Actions).

## Contexto

La fase D0 del plano de entrega (ADR 0260) pedía escaneo de secretos, dependencias, IaC/Dockerfiles y análisis
estático antes de tener credenciales de nube. Ya existían `check:secrets` (patrones propios), `supply-chain`
(licencias + `pnpm audit`) y el SBOM CycloneDX (ADR 0070).

## Decisión

Nuevo job `security` en `ci.yml`, en cada push y PR:

| Escáner | Qué cubre | Cómo se fija la versión |
| --- | --- | --- |
| Gitleaks 8.30.1 | secretos en todo el historial de git (`.gitleaks.toml` extiende las reglas por defecto) | imagen por digest |
| Trivy 0.74.0 | vulnerabilidades del lockfile, configuración de Dockerfiles (e IaC cuando exista) y secretos; falla con HIGH/CRITICAL | imagen por digest |
| OSV-Scanner 2.6.0 | avisos de OSV.dev sobre `pnpm-lock.yaml` (segunda fuente además de `pnpm audit`) | `go install …@v2.6.0` (checksum de Go) |
| Semgrep 1.178.0 | reglas propias en `.semgrep/dizaster.yml`, bloqueantes; reglas públicas `p/typescript` solo informativas | `pipx run semgrep==1.178.0` |

Reglas propias de Semgrep (invariantes que un linter genérico no conoce): sin `eval`/`new Function`; sin
desactivar TLS; sin shell por cadena (`exec`, `execSync`, `shell: true`); sin `Math.random` en el backend; los
conectores de IA nunca escriben `"OFFICIALLY_CONFIRMED"` ni `"FALSE"`; SQL sin concatenación. La única excepción
marcada es `dzd run-gates`, que ejecuta comandos que salen de `planGates` (código versionado).

Las reglas públicas del registro de Semgrep cambian sin versión: por eso no bloquean. Solo bloquean las propias.

`check:workflows` exige además que toda imagen usada con `docker run` en un workflow vaya fijada por digest.

Hallazgo corregido: Trivy marcó `infra/docker/db.Dockerfile` (DS-0002, contenedor como root). La imagen ahora
termina con `USER postgres`; el entrypoint oficial de `postgis/postgis` arranca sin root si el directorio de datos es
de `postgres`, como en un volumen nuevo (probado con la imagen base: `uid=999(postgres)`, PostGIS responde).

## Consecuencias

- Resultado local al 2026-09-30: Gitleaks sin hallazgos en 269 commits; Trivy sin HIGH/CRITICAL; Semgrep propio
  sin hallazgos. OSV.dev no es alcanzable desde el entorno de desarrollo, así que su primera ejecución real será en
  GitHub Actions (D1, BLOCKED_BY_OWNER: repositorio en GitHub).
- Un volumen local de desarrollo creado con la imagen anterior (datos de root) puede necesitar recrearse con
  `docker compose down -v`; solo afecta a desarrollo.
- No se añade ningún servicio de pago ni cuenta: Semgrep corre con `--metrics=off` y sin login.

# ADR 0260 — Plano de Software Delivery propio: Dizaster Delivery Control Plane

- Estado: Aceptado (diseño; implementación por fases)
- Fecha: 2026-09-30
- Relación con el Blueprint: §20 (nuevo), §4.3 CI/CD, §13.1, §17 fase 1
- IA: **NO AI REQUIRED** (asistente de IA opcional y apagado). Costo fijo: 0.

## Contexto

El propietario pidió un agente propio de construcción, delivery, pruebas, seguridad y operación, inspirado en las
capacidades útiles de plataformas como Harness, sin pagar ni depender de Harness, separado del runtime del producto y
con autonomía máxima para Claude acotada por políticas y permisos. Pidió primero auditar lo existente y no duplicar.

Lo que ya existe y se reutiliza:

| Pieza | Dónde |
|---|---|
| CI (lint, fronteras, typecheck, build, pruebas PostGIS/H3 + S3 simulado, restauración de respaldo, bundle y nativos) | `.github/workflows/ci.yml` |
| Cadena de suministro: licencias, `pnpm audit` con allowlist con vencimiento, SBOM CycloneDX, Dependabot | ADR 0070, `scripts/supply-chain.mjs` |
| Escáner de secretos propio | ADR 0218, `scripts/check-secrets.mjs` |
| Imagen OCI única API/worker, usuario sin privilegios, healthcheck | `infra/docker/core.Dockerfile` |
| Migraciones hacia adelante, una transacción por archivo | `services/core/src/platform/migrate.ts` |
| Respaldo cifrado con clave pública, retención, prueba de restauración en CI | ADR 0189, `scripts/db-backup.sh` |
| `/health`, `/health/ready`, latido del worker, outbox en cuarentena | ADR 0187, 0206 |
| OpenTelemetry, logs sin coordenadas ni IP, correlación, alertas SLO | ADR 0052, 0204, 0172, 0130 |
| Runbooks de operación | ADR 0127, `docs/runbooks/` |
| Esquema de configuración con guardas de producción | `services/core/src/platform/config.ts` |
| Build móvil EAS manual | `.github/workflows/mobile-build.yml` |

Lo que falta: pipeline de despliegue, entornos staging/producción, IaC, registro de imágenes, gestor de secretos en la
nube, política de riesgo, selección de pruebas, firma y procedencia de artefactos, verificación y rollback
automáticos, auditoría de delivery, Cost Guard de delivery.

## Decisión

1. **Nombre:** "Dizaster Delivery Control Plane" (Delivery Plane, CLI `dzd`). "Build & Delivery Agent" queda como
   alias. Motivo: es sobre todo un plano de control determinístico; la IA es un accesorio opcional.
2. **Forma:** un paquete TypeScript del monorepo (`tools/delivery`) con una CLI, ejecutada por **GitHub Actions**. Sin
   servidor, sin cola, sin base de datos, sin microservicios. Configuración y políticas versionadas en
   `delivery/policy.json`.
3. **Módulos internos** (los 22 componentes conceptuales, agrupados):

   | Módulo | Componentes | Reutiliza |
   |---|---|---|
   | `inspect` | Repository Inspector, Change Detector, Impact Analyzer, Dependency Analyzer | git, grafo de pnpm, mapa de módulos de `check:boundaries` |
   | `plan` | Task Planner, Test Orchestrator | scripts `pnpm` existentes, vitest |
   | `security` | Security Engine | `check:secrets`, `supply-chain`, `sbom`; añade Gitleaks, OSV-Scanner, Semgrep, Trivy (todos open source) |
   | `build` | Build Engine, Artifact Manager | Dockerfile existente; digest, SBOM, cosign keyless |
   | `deploy` | Environment Manager, Deployment Engine, Verification Engine, Rollback Engine, Health Monitor | `/health/ready`, alertas SLO, revisiones de Cloud Run |
   | `policy` | Policy Engine, Permission Guard, Secrets Boundary, Cost Guard | reglas en JSON, evaluación determinística |
   | `audit` | Audit Engine | registros JSON append-only |
   | `docs` | Documentation Updater | prueba OpenAPI existente; verifica ADR/IMPLEMENTATION_STATUS/runbooks |
   | `diagnose` | Failure Analyzer | patrones de error conocidos |
   | `assist` | Optional AI Engineering Assistant | apagado; interfaz propia, nunca el AI Core del producto |

4. **Separación del runtime:** `check:boundaries` impedirá que `services/core` o `apps/mobile` importen
   `tools/delivery` y viceversa. Producción no llama al Delivery Plane. Si el Delivery Plane, GitHub Actions, Claude o
   una IA fallan, la última versión desplegada sigue funcionando.
5. **Determinístico primero:** lint, typecheck, pruebas, build, validación de migraciones y esquemas, dependencias,
   escaneo, hashing, verificación de artefactos, estado de despliegue, health checks, rollback, validación de entorno,
   configuración, permisos y políticas son código sin IA. El asistente de IA solo resume fallos, propone arreglos o
   pruebas cuando se active con presupuesto propio.
6. **Free-first:** solo herramientas open source, incluidas en GitHub o con capa gratuita documentada (ADR 0261). Una
   herramienta de pago requiere justificación y aprobación.
7. **Harness:** solo referencia conceptual. Sin SDK, sin cuenta, sin código copiado. Integración externa opcional en
   el futuro únicamente si conviene y hay presupuesto.

## Consecuencias

- El Blueprint gana la §20. La implementación sigue las fases de `IMPLEMENTATION_STATUS.md` ("Plano de entrega");
  lo que necesita el repositorio de GitHub (D-20) o el proyecto de Google Cloud (D-18/ADR 0261) queda BLOQUEADO hasta
  que existan.
- Nada de lo nuevo toca el runtime del producto ni cambia su comportamiento.

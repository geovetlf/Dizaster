# ADR 0265 — Delivery Control Plane: CLI `dzd` con políticas, impacto, gates, artefactos, despliegue y auditoría

- Estado: Aceptado (fase D0 del plano de entrega)
- Fecha: 2026-09-30
- Relación con el Blueprint: §20.2–§20.24; ADR 0260, 0261, 0262
- IA: **NO AI REQUIRED** (el asistente de IA sigue sin implementar y apagado). Costo: 0. Sin red salvo `dzd verify`.

## Contexto

El propietario pidió materializar el Delivery Control Plane dentro del repositorio, separado del runtime, sin IA
obligatoria, sin servicios de pago y sin tocar nada que requiera D-18, D-23 o D-24.

## Decisión

Paquete `tools/delivery` (`@dizaster/delivery`, sin dependencias de runtime) con la CLI `dzd` (`pnpm dzd …`):

| Comando | Módulo | Qué hace |
|---|---|---|
| `inspect` | Repository Inspector, Change Detector, Impact Analyzer, Dependency Analyzer | archivos, paquetes y dependientes, módulos del core, áreas, clase de riesgo, regresión completa |
| `plan` / `run-gates` | Task Planner, Test Orchestrator | gates por etapas (barato primero), pruebas solo de lo afectado salvo regresión completa; se detiene en el primer rojo y diagnostica |
| `policy` | Policy Engine | resultado `auto`/`review`/`approval`/`block` por entorno según `delivery/policy.json`; `block` falla |
| `autonomy` | Permission Guard | decide si una acción puede ocurrir sola en el nivel vigente (2) |
| `audit` / `audit verify` | Audit Engine | registro JSONL encadenado por hash; detecta cambios, borrados y reordenamientos |
| `artifact` / `artifact verify` | Artifact Manager | manifiesto (versión, commit, digest, SBOM, entorno, pruebas, seguridad) y rechazo de artefactos sin origen verificable |
| `verify` | Verification Engine, Health Monitor | `/health`, `/health/ready`, contrato OpenAPI, con latencia máxima |
| `iac-check` | Cost Guard, IaC | revisa planes de OpenTofu (nada de borrar/reemplazar recursos con datos; tipos que pueden costar → aprobación) y HCL de IAM (sin roles primitivos ni comodines) |
| `diagnose` | Failure Analyzer | clasifica fallos por patrones (tipos, lint, prueba, secreto, runner…) y dice si se puede reintentar |
| `docs` | Documentation Updater | una migración o un cambio de política/IaC trae su ADR o runbook |

Además, en código y con pruebas: despliegue gradual con rollback automático de tráfico (`deploy.ts`) y el destino
Cloud Run por `gcloud` (`cloudrun.ts`), que **no se ejecuta contra la nube** hasta D-18; se usa con un ejecutor
falso en pruebas.

- **Política del repositorio** (`delivery/policy.json`): bajo = documentación, pruebas y traducciones; crítico =
  identidad, cifrado, configuración, reporte y ubicación, geo-kit, verificación, eventos, alertas, ingestión,
  moderación, emergencia, migraciones, infraestructura, CI, políticas, gates y dependencias; por defecto medio.
  Invariantes que la validación impone: `blocked` bloquea en todo entorno y lo crítico en producción pide aprobación.
  Presupuestos de nube, IA y EAS en 0: cualquier gasto se bloquea hasta que el propietario fije un presupuesto.
- **Migraciones:** una migración ya existente no se edita; `DROP TABLE/COLUMN`, `RENAME`, cambio de tipo y
  `TRUNCATE`/`DELETE` de tablas no derivadas quedan `blocked`. Las 102 migraciones históricas pasan la regla.
- **Separación:** `check:boundaries` falla si `tools/delivery` importa código del producto o si el producto importa
  el Delivery Plane.
- **CI:** job `delivery` (impacto, plan, política, documentación y auditoría como artefacto).

## Consecuencias

- Pruebas en `tools/delivery/test/`. Runbook: `docs/runbooks/delivery-plane.md`.
- Pendiente y BLOQUEADO: firma cosign e informes en PR (repositorio de GitHub, D-20), despliegue real y
  verificación en staging (D-18, D-23), promoción a producción (D-24 y visto bueno del nivel 5).

# ADR 0303 — Reglas de `main` y entornos de GitHub compatibles con el flujo de PR del agente

- Estado: Aceptado. Aplicado en GitHub por el propietario el 2026-10-08 (ver "Aplicación")
- Fecha: 2026-10-01
- Relación con el Blueprint: §20.7, §20.11, §20.13; ADR 0264, 0277, 0284
- IA: **NO AI REQUIRED**. Costo: 0 (el repositorio es público: rulesets y revisores de entornos no dependen del plan).

## Contexto

El 2026-10-01 a las 03:17 el propietario pidió aplicar ya las reglas de `main` y de los entornos: proteger `main`,
exigir CI en verde antes de fusionar, separar staging de producción, impedir que un PR se salte los controles y mantener
rollback y auditoría, sin Google Cloud, sin `EXPO_TOKEN` ni credenciales de producción.

El ruleset de ADR 0277 se escribió antes de que el repositorio existiera y no encajaba con el flujo aprobado después:

- Exigía una aprobación de CODEOWNERS. El agente trabaja en GitHub con la identidad del propietario (`geovetlf`) y
  GitHub no deja aprobar un PR propio. Cada PR habría quedado bloqueado, y la única salida (un bypass) también se
  salta los checks.
- El propietario autorizó el 2026-09-30 que el agente fusione sus propios PRs con todos los checks en verde.
- Faltaba `report-comment`, el séptimo check de CI (ADR 0284).

## Decisión

**Ruleset `main protegida`** (`.github/rulesets/main.json`), sobre la rama por defecto, `enforcement: active`:

| Regla | Valor | Por qué |
| --- | --- | --- |
| `bypass_actors` | ninguno, tampoco administradores | nadie se salta las reglas |
| `deletion` | activa | `main` no se puede borrar |
| `non_fast_forward` | activa | sin force push |
| `required_linear_history` | activa | historial lineal; el rollback es un revert de un commit |
| `pull_request` | aprobaciones 0, hilos resueltos, squash o rebase | todo entra por PR; sin aprobación humana (ver Contexto) |
| `required_status_checks` | `check`, `delivery`, `report-comment`, `supply-chain`, `security`, `iac`, `image` | los 7 checks de CI |
| `integration_id` | 15368 (GitHub Actions) en cada check | un estado con el mismo nombre publicado por otra vía no cuenta |
| `strict_required_status_checks_policy` | activa | el PR debe estar al día con `main` |

**Ruleset `etiquetas de versión inmutables`** (`tags.json`): `v*` no se borra, no se mueve, no se reescribe.

**Entornos** (`scripts/github-bootstrap.mjs --only rules`):

- `staging`: solo ramas protegidas, sin revisores. Despliega el agente cuando exista GCP (D-18).
- `production`: solo ramas protegidas y el propietario como revisor obligatorio.

**Guarda en la entrega.** `deliver.yml` tiene un job `guard` que corre antes que staging. Lee con el token del propio
workflow (`contents: read`, `actions: read`) las reglas efectivas de `main` y, con `promote=true`, el entorno
`production`. `dzd github-guard` falla cerrado si `main` no exige PR, los 7 checks, sin force push y sin borrado, o si
`production` no existe, no tiene un owner de `delivery/policy.json` como revisor o acepta cualquier rama. Así, aunque las
reglas se quiten o no se apliquen, nada sale hacia staging ni producción.

**Flujo del agente desde ahora:** fusiona con `squash` (o `rebase` para Dependabot), solo con los 7 checks en verde.

## Aplicación (2026-10-08)

El propietario aplicó las reglas a mano. El agente las leyó por la API (`GET /repos/geovetlf/Dizaster/rulesets` y
`/rules/branches/main`) y `dzd github-guard` las da por buenas:

- Ruleset `dizaster main protection` (id 24722130), `active`, sobre `refs/heads/main`, sin bypass
  (`current_user_can_bypass: never`). `main` figura como protegida.
- Reglas: `deletion`, `non_fast_forward`, `required_linear_history`, `pull_request` con 0 aprobaciones y
  `required_status_checks` estricto con los 7 checks, todos con `integration_id` 15368.
- Diferencias con `.github/rulesets/main.json`, ninguna debilita lo esencial: no exige resolver hilos de revisión ni
  descarta revisiones antiguas al hacer push (sin aprobaciones obligatorias, no afectan), y admite el método `merge`,
  que el historial lineal ya impide.
- Falta el ruleset de etiquetas `v*` (`tags.json`). No bloquea nada hoy porque aún no hay versiones.
- Entornos `staging` y `production`: el proxy de la sesión no deja leerlos. El job `guard` de `deliver.yml` sí los lee
  con el token del workflow y se detiene si `production` no tiene al propietario como revisor.

## Limitación

- **Este entorno de ejecución no puede aplicar las reglas.** El proxy de la sesión bloquea la escritura en
  `/repos/{repo}/rulesets` y todo `/repos/{repo}/environments`. El modo automático también rechazó cambiar reglas de la
  cuenta. GitHub Actions tampoco puede: el `GITHUB_TOKEN` no tiene permiso de administración, y crear un token para
  eso está prohibido (sin credenciales nuevas). Por eso el propietario las aplica una vez desde el navegador. Los pasos
  están en `docs/runbooks/activacion-bloqueos.md` §1.
- **GitHub no distingue al agente del propietario** porque comparten la identidad `geovetlf`. La aprobación de
  `production` y el chequeo `owners` de `dzd` se apoyan en eso. Compensan: el agente nunca aprueba `production` (regla
  vigente), producción no tiene credenciales hasta D-18, y `dz-deploy` solo despliega.
- CODEOWNERS se mantiene para avisar, pero su revisión no es obligatoria, por la misma razón.

## Consecuencias

- Con las reglas aplicadas, un PR no puede fusionarse sin los 7 checks en verde y al día con `main`, ni siquiera por
  un administrador. `main` no admite push directo, force push ni borrado.
- Rollback: `dzd rollback` (sin cambios) y revert de un único commit por el historial lineal. Auditoría: la de `dzd` y
  el registro de rulesets de GitHub (Settings → Rules → Insights).
- Pruebas: `tools/delivery/test/github-guard.test.ts` comprueba el ruleset versionado (7 checks, sin bypass, Actions
  como origen) y que la guarda bloquea cada caso.

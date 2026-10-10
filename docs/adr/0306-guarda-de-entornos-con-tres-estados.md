# ADR 0306 — Guarda de entrega: staging, bypass de administradores y "no verificable" distinto de "incorrecto"

- Estado: Aceptado
- Fecha: 2026-10-10
- Relación con el Blueprint: §20.11, §20.13; ADR 0277, 0303
- IA: **NO AI REQUIRED**. Costo: 0.

## Contexto

La guarda de `deliver.yml` (ADR 0303) revisaba las reglas de `main` y, solo al promover, el entorno `production`.
Revisión del 2026-10-10:

- `staging` no se revisaba: si el entorno desaparecía, GitHub lo recrearía al vuelo sin límite de ramas.
- `deliver.yml` es `workflow_dispatch` y puede lanzarse desde cualquier rama; nada lo impedía en la guarda.
- `production` no comprobaba `can_admins_bypass`. GitHub lo pone en `true` por omisión, así que un administrador podría
  desplegar sin la aprobación del propietario, y `scripts/github-bootstrap.mjs` no lo desactivaba.
- Si la lectura de `production` fallaba por permisos o red, el workflow escribía `null` y la guarda decía "el entorno no
  existe". Fallaba cerrado, pero confundía "no se pudo verificar" con "está mal configurado".

## Decisión

- Cada lectura de la API deja el cuerpo o el error de `gh`. `dzd github-guard` distingue tres estados:
  **verificado** (sin hallazgo), **incorrecto** (`incorrect`: falta una protección, o 404) y **no verificable**
  (`unverifiable`: 403, red, respuesta que no es JSON o lectura ausente). Los dos últimos detienen la entrega.
- La guarda exige además:
  - que la entrega corra desde `refs/heads/main`;
  - que `staging` exista y acepte solo ramas protegidas (siempre, no solo al promover);
  - que `production` tenga `can_admins_bypass: false`, además del owner como revisor y solo ramas protegidas.
- `scripts/github-bootstrap.mjs` crea `production` con `can_admins_bypass: false`.
- Cuando no hay hallazgos imprime lo verificado en una línea; nunca da por bueno lo que no pudo leer.

## Consecuencias

- Si `staging` no limita las ramas o `production` deja bypass a administradores, la primera entrega se detiene con el
  motivo exacto. El propietario lo corrige en *Settings → Environments* (es configuración manual de GitHub; el agente no
  puede escribirla desde la sesión).
- La guarda solo corre dentro de Actions con el token del workflow; desde la sesión del agente los entornos siguen sin
  poder leerse, y así se informa: no verificado, no "correcto".
- Pruebas: `tools/delivery/test/github-guard.test.ts`.

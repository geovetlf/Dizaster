# ADR 0272 — `dzd`: despliegue, promoción y rollback en seco, validación de configuración, métricas e informe

- Estado: Aceptado. Ejecutar contra Google Cloud (`--execute`): BLOCKED_BY_OWNER / BLOCKED_BY_BILLING (D-18)
- Fecha: 2026-09-30
- Relación con el Blueprint: §20.5, §20.8, §20.13, §20.14, §20.15, §20.19, §20.21; ADR 0262, 0265, 0267
- IA: **NO AI REQUIRED**. Costo: 0.

## Contexto

La auditoría del Delivery Plane del 2026-09-30 encontró lógica sin punto de entrada: `rollout` y `rollbackTo` eran
librería; `costGate` no estaba en la CLI; no se guardaba qué versión, configuración y migración tenía lo anterior;
la verificación posterior solo miraba salud y OpenAPI; nada validaba la configuración antes de desplegar; no había
métricas de entrega ni informe para el PR.

## Decisión

Nuevos comandos de `dzd`, todos **en seco por defecto** (imprimen los `gcloud` sin ejecutarlos). `--execute` solo
tendrá sentido cuando existan los proyectos (D-18).

- `dzd deploy --env staging --digest sha256:… --project … --region … --image …` y `dzd promote --digest …`:
  despliegue gradual con verificación y rollback automático de tráfico (`rollout`). Producción solo acepta un digest
  que ya quedó desplegado en staging. Si el actor no es una persona (`--actor claude|delivery-plane`), se aplica el
  nivel de autonomía (ADR 0262): hoy nivel 2, así que la automatización no despliega (sale con 3).
- `dzd rollback --env … [--to previous|sha256:…]`: vuelve el tráfico a la versión anterior servida (dos rollbacks
  seguidos no se quedan en la misma) y dice hasta qué migración es compatible su esquema.
- Registro de versiones `delivery-releases.jsonl` (`releases.ts`): entorno, servicio, revisión, digest, resultado,
  versión anterior, sha256 de la configuración y última migración de la imagen.
- `dzd config-check --env-file …`: ejecuta `services/core/dist/config-check-cli.js` en otro proceso (el Delivery Plane
  no importa el runtime) con las mismas reglas de producción de `loadEnv`. Los secretos se declaran `secret:<id>`: se
  comprueba que existan, nunca su valor, y no se imprime ningún valor.
- `dzd cost --resource … --estimate … --used …`: expone el Cost Guard; un recurso sin presupuesto vale 0.
- `dzd audit stats`: despliegues, tasa de fallos, despliegues por semana y mediana de recuperación, solo con el
  registro de auditoría.
- `dzd report [--out archivo]`: informe Markdown del cambio (riesgo, política por entorno, migraciones, gates). CI lo
  genera y lo guarda como artefacto; publicarlo en el PR espera al repositorio (D-20).
- `dzd verify` suma lecturas públicas del camino crítico: `/v1/config`, catálogo, mapa por bbox (PostGIS) y feed.
  Probado contra la API local: todo en verde salvo `/health/ready`, que da 503 sin worker, como debe.

No se cablea `dzd cost` al build móvil: con `eas-builds: 0` bloquearía cualquier build. El presupuesto de EAS lo fija
el propietario.

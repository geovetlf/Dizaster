# ADR 0187 — Latido del worker y `/health/ready`

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno (monitor externo gratuito, a elegir por el propietario)

## Contexto

§5.22 y §13.1: hay que saber desde fuera si el sistema funciona. `/health` solo comprobaba que la API ve la base de
datos. Si el worker se caía o un bucle se colgaba, las alertas dejaban de salir y nada lo delataba.

## Decisión

- Migración 0089: `platform.worker_heartbeats (instance_id, role, started_at, beat_at)`.
- Cada bucle del worker (urgent, normal, maintenance) late tras cada vuelta completa, como mucho cada 10 s. Una
  vuelta colgada deja de latir aunque el proceso siga vivo. Instancia = `WORKER_INSTANCE_ID` o el hostname.
- `GET /health/ready`: 200 si la base responde, cada rol latió hace menos de `WORKER_HEARTBEAT_STALE_SECONDS`
  (180 por defecto, cualquier instancia) y el evento de dominio listo más viejo tiene menos de
  `OUTBOX_READY_MAX_AGE_SECONDS` (300). Si no, 503 con los códigos (`worker.<rol>.stale|never`, `outbox.stuck`,
  `database`). Solo edades y códigos, ningún dato de personas.
- Contenedores: la imagen trae `HEALTHCHECK` de la API contra `/health` (vivo). En compose el worker usa
  `dist/worker-health-cli.js` (¿esta instancia late en todos sus roles?) y ambos tienen `restart: unless-stopped`.
  `/health/ready` no se usa para reiniciar la API: es para un monitor externo.
- Latidos de instancias que no laten desde hace un día se borran en la retención diaria.

## Consecuencias

- Un monitor gratuito externo sobre `/health/ready` avisa de un worker parado. Elegir el monitor queda al propietario
  (sin credenciales ni coste aquí).
- Prueba: `services/core/test/worker-heartbeat.test.ts`.

# ADR 0282 — Destino local de entrega, proxy de tráfico y prueba de carga

- Estado: Aceptado
- Fecha: 2026-09-30
- Relación con el Blueprint: §20.13–20.15 (entrega, verificación, rollback), §5.22 (SLO); ADR 0272, 0277
- IA: no. Costo: 0 (solo la máquina local).

## Contexto

El camino CODE → … → PRODUCTION → ROLLBACK estaba probado con destinos falsos y en seco, porque staging no existe
(D-18, D-23). Faltaban dos cosas:

- ensayar la entrega con contenedores reales, verificación HTTP real, reparto de tráfico y rollback;
- una prueba de carga que alimente `dzd slo`.

## Decisión

1. **`LocalDockerTarget`** (`tools/delivery/src/local.ts`) implementa la misma interfaz `DeployTarget` que Cloud Run:
   - cada revisión es un contenedor en red de host, con su propio `PORT`, levantado por digest;
   - el estado (revisiones y reparto) vive en `.dzd/local-state.json`;
   - al llegar al 100 % quedan solo la revisión que sirve y la anterior;
   - un rollback a una revisión ya borrada vuelve a levantar el mismo digest, nunca reconstruye.
2. **`dzd local-proxy`**: escucha solo en 127.0.0.1 y reparte cada petición de forma determinística (10 % = 10 de
   cada 100 seguidas). Marca la respuesta con `x-dz-revision`.
3. **`dzd deploy|rollback --env local`**: el mismo `rollout` de staging, sin nube.
   - No hay autonomía que decidir: es la máquina de quien lo ejecuta.
   - La firma se verifica solo con `--key`.
   - Los registros quedan con `env: local`, así que `promote` nunca los acepta.
4. **Carga**:
   - `dzd load` es una carga mínima sin dependencias: solo lecturas públicas, con concurrencia acotada.
   - `infra/load/smoke.js` es el script de k6, con los contadores `server_errors` y `rate_limited`.
   - `dzd slo` cuenta los 429 aparte ("límite por IP"). Solo bloquean los 5xx y la p95.

## Hallazgo del ensayo

La primera prueba con k6 dio 22 % de fallos. No eran errores de la API: el límite de 300 peticiones por minuto por IP
respondía 429, y `http_req_failed` de k6 los contaba como fallos. `fromK6Summary` los trataba como errores de
servidor.

- **Corregido:** los 429 se informan aparte.
- **Consecuencia operativa:** una prueba de carga desde un solo origen mide el límite, no la API. Por eso se sube el
  límite solo en el entorno local.

## Ensayo realizado (2026-09-30)

Dos imágenes locales del core sobre PostGIS local:

1. v1 fue rechazada al principio porque faltaba el worker (`/health/ready` 503). Con el worker, se desplegó: candidata,
   10 % y 100 %.
2. v2 se desplegó de la misma forma.
3. Carga de 300 peticiones: p95 31 ms, sin 5xx.
4. Se hizo rollback a v1: volvió a levantar el digest, con el tráfico al 100 %.
5. Una candidata con base inexistente fue rechazada. El tráfico siguió en v2 y la auditoría registró `failed`.
6. k6 a 50 peticiones por segundo durante 30 s, con el límite subido: p95 5 ms, sin 5xx.
7. `audit verify` quedó íntegra.

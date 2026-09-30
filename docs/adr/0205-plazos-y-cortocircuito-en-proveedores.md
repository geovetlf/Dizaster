# ADR 0205 — Plazos y cortocircuito para push y almacenamiento

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

§5.14 fija 2 minutos para que un aviso urgente oficial llegue, y §12.2 pide que un proveedor externo no tumbe el
sistema. APNs (HTTP/2), FCM y S3 no tenían plazo: un proveedor que acepta la conexión y no responde retenía el envío
indefinidamente. Además el gateway enviaba APNs y después FCM, así que un APNs colgado frenaba también Android. El
único cortocircuito existente era el de la ingesta (por fuente).

## Decisión

- Plazo por petición: APNs cancela el stream (`NGHTTP2_CANCEL`) y FCM usa `AbortSignal.timeout`, las dos con
  `PUSH_REQUEST_TIMEOUT_MS` (10 s). S3 usa `STORAGE_REQUEST_TIMEOUT_MS` (120 s, por los videos de hasta 60 MB). Un
  plazo vencido cuenta como error temporal y el aviso se reintenta como cualquier otro (ADR 0177).
- El gateway envía a APNs y FCM en paralelo.
- `platform/breaker.ts` (`CircuitBreaker`) y `GuardedSender` para cada proveedor de push:
  - Se abre tras `PUSH_BREAKER_THRESHOLD` (5) lotes seguidos en los que todo falla de forma temporal.
  - Espera `PUSH_BREAKER_COOLDOWN_MS` (30 s), que se duplica en cada nueva apertura hasta un máximo de 10 min.
  - Después deja pasar un solo lote de prueba.
  - Con el circuito abierto no se llama al proveedor, y los mensajes vuelven como reintentables (`CIRCUIT_OPEN`).
  - Un token inválido no cuenta como caída.
- Abrir el circuito suma la métrica `push.circuit_open` por proveedor y deja `push.circuit.open` en el log (y
  `push.circuit.closed` al recuperarse).

## Consecuencias

- Un proveedor caído cuesta como mucho un plazo por lote hasta que se abre el circuito, y después nada.
- Prueba `provider-timeouts.test.ts`: servidores locales que nunca responden (HTTP/2 y HTTP) y el ciclo completo del
  cortocircuito.

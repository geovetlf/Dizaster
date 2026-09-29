# ADR 0129 — Firma en el dispositivo de la evidencia offline

Estado: aceptada (2026-09-29)

## Contexto
§8.1 ("firma borrador"), §8.3 y C-04 piden que el reporte se capture y firme en el teléfono, y que al reconectar se
envíe como "capturado offline" con tolerancia por categoría. Hasta ahora la app no firmaba nada y además enviaba
siempre `capturedOffline: false` con la hora del reloj de la captura: un reporte retenido en la cola llegaba
penalizado por desfase de reloj, y cualquiera con un token podía afirmar "estaba sin conexión" para ampliar la
ventana de tiempo.

## Decisión
- Cada teléfono tiene una semilla Ed25519 en el almacén seguro (Keychain / Keystore, solo este dispositivo). Al
  iniciar sesión registra la clave pública: `PUT /v1/devices/:id/signing-key` (idempotente; una nueva reemplaza la
  anterior, que sigue valiendo para lo capturado antes del reemplazo; una clave reemplazada no se reutiliza).
  Tabla `identity.device_signing_keys` (migración 0056). La privada nunca sale del teléfono.
- Al capturar, la app firma el texto canónico `evidenceSigningPayload` (contratos, común a app y servidor): id del
  reporte, categoría, afirmación, pin, hora de captura, dispositivo, fix GNSS (lugar, precisión, hora), ubicación
  simulada y los SHA-256 de la media. No se firman la hora de envío ni `capturedOffline`, que la cola fija al
  enviar: reloj actual y `capturedOffline = true` si el reporte estuvo retenido más de 2 min.
- El servidor verifica con el Ed25519 de Node y guarda el veredicto en `report.reports.evidence_signature`:
  - VALID: clave del dispositivo, registrada antes de la captura (±5 min de reloj) y no reemplazada antes de ella;
    la firma corresponde y toda la media adjunta está entre los hashes firmados.
  - INVALID: clave del dispositivo pero firma o media que no corresponden (alteración tras la captura).
  - ABSENT: sin firma, clave desconocida, registrada después de la captura o reemplazada antes.
- Reglas `presence-4`: un envío offline dentro de la tolerancia solo la conserva con firma VALID; si no, es
  testimonio tardío (`UNSIGNED_OFFLINE_EVIDENCE`: mitad de peso, no crea pin). INVALID resta 1 (queda LOW,
  `DEVICE_SIGNATURE_INVALID`). En línea la firma es opcional. Los reportes viejos se auditan con su versión.
- Si el almacén seguro falla, el reporte sale sin firma: nunca se bloquea un aviso. Librería: `@noble/curves`
  (MIT, JavaScript puro, sin módulo nativo; misma familia que `@noble/hashes`, ya usada). NO AI REQUIRED; costo cero.

## Límites
Una clave en software sube el costo de fabricar reportes con solo un token (scripts, tokens robados), pero no
detiene a quien extrae la semilla de un teléfono rooteado. La clave en hardware con atestación (Secure Enclave /
App Attest, Android Key Attestation) queda pendiente del build de desarrollo (EXPO_TOKEN, propietario), igual que la
atestación de app (ADR de Identity). El diseño no cambia: solo el origen de la clave.

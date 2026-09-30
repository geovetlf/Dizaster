# ADR 0280 — AI Core resiliente: límite de tasa, cortocircuito, prompts versionados, registro de modelos, evaluación y pistas asíncronas

- Estado: Aceptado
- Fecha: 2026-09-30
- Relación con el Blueprint: §6 (IA mínima), §13; ADR 0019, 0064, 0110, 0205, 0217
- IA: opcional. Costo: 0 (sin proveedor real; el kill switch `ai` sigue encendido de fábrica).

## Contexto

La instrucción del 2026-09-30 19:32 exige que REPORT → BACKEND → guardar funcione aunque no haya proveedor, el router
falle, la API externa falle o haya límite de tasa; que la IA enriquezca después; y que existan registro de modelos,
control de versiones de prompts, evaluación y pruebas de regresión. La auditoría encontró:

- ningún consumidor del AI Core;
- un 429 tratado como error genérico, sin espera ni cortocircuito;
- instrucciones como texto libre, sin versión;
- ni registro de modelos ni evaluación.

## Decisión

- `AiProviderError` tipado. `RATE_LIMITED` respeta `retryAfterMs`, y un `CircuitBreaker` (ADR 0205) por proveedor
  se abre tras 3 fallos seguidos, con espera de 30 s a 10 min. Los estados nuevos del registro de llamadas son
  `RATE_LIMITED`, `CIRCUIT_OPEN` y `UNREGISTERED_MODEL` (migración 0104).
- `prompts.ts`: plantillas con id, capacidad, versión y huella sha256. `AiCore.run` acepta una plantilla, rechaza
  plantillas de otra capacidad sin llamar a nadie y registra `prompt_id`/`prompt_version`.
- `models.ts`: registro con proveedor, modelo, capacidades, estado, salida de datos y precio (null si no se conoce;
  no se inventa). Se exige con `COST_MODE=metered`.
- `ai-eval.ts`: evaluación determinística reutilizable contra cualquier proveedor.
- **Pista de verificación asíncrona:**
  - `EventEvidenceAdded` encola una fila en `verification.ai_jobs` solo si `ANALYZE_REPORT` tiene ruta.
  - El worker (cada minuto, solo con IA encendida) llama `verification-hint@1` con hechos agregados: categoría,
    país, nivel por reglas y conteos por confianza, afirmación y presencia.
  - La salida debe ser JSON con un nivel sugerible (`UNVERIFIED`, `COMMUNITY_CORROBORATED`,
    `EXTERNALLY_CORROBORATED` o null). Todo lo demás se descarta (`INVALID_OUTPUT`).
  - Transitorios (tiempo, error, 429, cortocircuito): hasta 3 intentos. `KILLED`, `NO_BUDGET` y `DISABLED` fallan
    en el acto.
  - Retención de trabajos cerrados: 30 días.

## Consecuencias

- Las pruebas demuestran que el reporte se guarda (200) con la IA apagada, con kill switch, caída, colgada o
  limitada. El estado de verificación nunca cambia por la IA.
- Integrar un proveedor real exige ahora: adaptador, modelo registrado, prompts evaluados con `runEval` contra él,
  presupuesto aprobado, `COST_MODE=metered` y apagar el kill switch. Nada de eso se hace sin el propietario.

# ADR 0110 — Catálogo de capacidades del AI CORE, registro de uso sin contenido e interfaces apagadas

Estado: aceptada (2026-09-29). Aplica el mensaje "Master continuity / low-cost intelligence" del propietario.

Nota: ADR 0217 renombra y amplía el catálogo a 13 capacidades y agrega el AI ROUTER.

## Contexto
El AI CORE (ADR 0064) ya era el único punto de uso de IA: un proveedor, apagado por defecto, detrás del CostGuard,
con minimización de datos y sin decidir estados. Faltaban: el catálogo de capacidades que pide el propietario (qué
hace cada una, si es necesaria, qué la sustituye sin IA, si cuesta, si es asíncrona), la observabilidad por llamada
(proveedor, modelo, capacidad, latencia, tokens, costo, estado, alternativa) y las interfaces de visión, embeddings y
datos de emergencia externos. Ningún módulo llama hoy al AI CORE: no hay función de DIZASTER que dependa de IA.

## Decisión
- `platform/connectors/capabilities.ts`: `AI_CAPABILITIES` = ANALYZE_REPORT, CLASSIFY_INCIDENT, ANALYZE_IMAGE,
  ANALYZE_VIDEO, DETECT_SIMILARITY, SUMMARIZE, EXTRACT_INFORMATION, MODERATE, TRANSLATE, OPERATIONAL_SUMMARY
  (reemplaza la lista `AI_TASKS`). `AI_CAPABILITY_INFO` declara para cada una: `required: false` (siempre), modalidad,
  asíncrona, puede costar, fase (INITIAL según §21 del mensaje, o LATER: video y traducción), regla determinista que
  la sustituye, lo que nunca puede hacer (p. ej. imagen: identificar personas, diagnósticos, declarar desastres) y
  tope de tokens de salida.
- `AiCore.run(capability, instrucciones, entrada, { subject, actorUserId, maxOutputTokens })`: imagen y video
  devuelven UNSUPPORTED hasta que exista un `VisionProvider`; el tope de salida nunca supera el de la capacidad.
- Registro `cost.ai_calls` (migración 0047) vía `AiCallSink`, implementado por el módulo cost: una fila por intento
  con la IA encendida, **sin contenido**; estado, `fallback`, latencia, tokens, costo estimado y real, sujeto
  (evento/reporte/post…) y persona. Con la IA apagada no se escribe nada (costo cero también en la base de datos).
  Retención 90 días; al borrar una cuenta se desvincula la persona. El tablero de costo añade `ai` por capacidad,
  proveedor y modelo, y la app de administración lo muestra.
- Interfaces apagadas `VisionProvider`, `EmbeddingProvider`, `EmergencyDataProvider` (`NoVision`, `NoEmbeddings`,
  `NoEmergencyData`) en `Connectors`. No se integra ningún proveedor, ni NVIDIA ni varios a la vez: activar uno es un
  adaptador más, con presupuesto aprobado y `COST_MODE=metered`.

## Consecuencias
- Presupuesto a cero o kill switch: toda capacidad devuelve `ok: false` y quien llama usa su regla; el núcleo sigue.
- Añadir una capacidad exige ADR y su regla determinista.

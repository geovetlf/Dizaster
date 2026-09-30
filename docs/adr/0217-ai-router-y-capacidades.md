# ADR 0217 — AI ROUTER y catálogo de 13 capacidades

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

El dueño pidió preparar la IA en capas (DIZASTER → AI CORE → AI ROUTER → PROVIDER ADAPTER → MODELO) con 13
capacidades con nombre fijo, sin conectar todavía NVIDIA, OpenAI, Gemini ni ningún otro proveedor, y que la app
funcione igual sin IA, con el router apagado, con los modelos caídos, sin claves y con presupuesto 0. El AI Core
(ADR 0064, 0110) tenía un solo proveedor para todo y 10 capacidades con otros nombres.

## Decisión

- Catálogo: ANALYZE_REPORT, CLASSIFY_INCIDENT, EXTRACT_INCIDENT_DATA, ANALYZE_IMAGE, ANALYZE_VIDEO, DETECT_DUPLICATE,
  GENERATE_EMBEDDING, TRANSLATE_TEXT, SUMMARIZE_INCIDENT, MODERATE_CONTENT, SAFETY_CLASSIFICATION,
  MULTIMODAL_REASONING, OPERATIONAL_SUMMARY. Los nombres anteriores quedan como alias (`canonicalCapability`).
  Cada una declara `required: false`, su regla determinista y `canBeDeterministic` (YES / PARTIAL).
- `AiRouter`: cadena de proveedores por capacidad (`AI_ROUTES="CAPACIDAD=a,b;*=c"`), vacía por defecto. Si uno falla,
  se agota su tiempo o no tiene presupuesto, prueba el siguiente; cada intento se registra sin contenido.
- Adaptadores (`AIProvider`) en un registro (`AI_PROVIDER_FACTORIES`): hoy solo `none` y `fixture`. Imagen, video,
  multimodal y embeddings solo van a un adaptador que los declare en `capabilities`.
- Configuración inválida (capacidad o proveedor desconocido) falla al arrancar. Producción rechaza `fixture` también
  en rutas. El modo costo cero sigue rechazando cualquier adaptador de pago.
- Sin agregadores: la prueba de regresión prohíbe hosts y dependencias de proveedores de IA (incluidos NVIDIA y
  OpenRouter) fuera de los conectores.
- Matriz "¿necesita IA? / ¿puede ser determinística?" en `docs/ENGINES_AND_CONNECTORS.md`.

## Consecuencias

- Agregar un proveedor es agregar un adaptador y una ruta; ni el AI Core ni los módulos cambian.
- Pruebas (`ai-router.test.ts`): rutas, respaldo entre proveedores, presupuesto, capacidades no textuales, y el flujo
  reportar → evento → verificación → feed con la IA apagada y con el modelo caído, sin ninguna llamada registrada.

# ADR 0315 — Las siete decisiones de producto de V1

- Estado: **Aceptado.** El propietario aprobó formalmente las siete decisiones por escrito el 2026-10-11, en el hilo
  «Blueprint maestro de Dizaster». Ya las había elegido el 2026-10-10 en tarjetas de decisión.
- Fecha: 2026-10-10 (expediente) · 2026-10-11 (aprobación)
- Relación con el Blueprint: §2 (C-06, C-07), §5.2, §5.3, §8, §13, decisiones D-02 y D-06; ADR 0004, 0063, 0156, 0171
- IA: **NO AI REQUIRED**. Costo: 0.

## Para qué sirve

Registra cada decisión con lo que hacía el código antes, lo que pide el propietario y dónde se implementa. Las
alternativas que se descartaron quedan al final, como contexto. Cada implementación tiene su propio ADR (0317 en
adelante).

## D1 — Ubicación precisa en categorías sensibles: 7 días

**Antes:** cada reporte guardaba cifrada la posición del teléfono (`report.presence_evidence.device_fix_enc`). Un
trabajo diario la borraba a los `PRESENCE_RETENTION_DAYS` días (30 por defecto, ADR 0004) y dejaba solo la celda H3
r7. El plazo era el mismo para todas las categorías.

**Decisión del propietario:**
- La ubicación precisa de las categorías sensibles se conserva 7 días.
- El plazo es configurable.
- Se mantienen el cifrado, el control de acceso, la minimización y el borrado efectivo al vencer.
- La ubicación precisa nunca sale en perfiles, publicaciones, mapas públicos ni exportaciones públicas.
- Se documentan las excepciones de conservación que pudieran ser obligatorias por ley.

## D2 — «No, es otro evento»: solo se registra

**Antes:** «Sí, es el mismo» cerraba la revisión. «No, es otro» solo se guardaba en
`event.dedup_reviews.reporter_answer` (ADR 0156).

**Decisión del propietario:**
- La respuesta registra la discrepancia y no cambia el evento, su estado ni su agrupación.
- Se añaden pruebas que lo garanticen.
- No se implementan acciones automáticas sin una nueva decisión.
- No se sustituye por otra recomendación. Separar el evento, que era la recomendación técnica, queda descartado.

## D3 — Reputación pública: «N reportes corroborados», ocultable

**Antes:** el perfil público no mostraba reputación. La reputación solo existía por dentro.

**Decisión del propietario:**
- El perfil público puede mostrar «N reportes corroborados».
- Cada persona puede ocultar ese recuento.
- No se publican puntajes internos ni evidencia privada.
- Se distingue la corroboración comunitaria de la confirmación oficial.
- El recuento es verificable, consistente y resistente a duplicados y manipulación.

## Suspensiones de cuenta: escalonadas

**Antes:** `SUSPEND_USER` no vencía. Duraba hasta que moderación la levantaba con `UNSUSPEND_USER`.

**Decisión del propietario:**
- Suspensiones de 24 horas, 7 días o permanentes.
- Existe un mecanismo de apelación.
- Queda registro auditable del motivo, la duración, quién la aplicó y el resultado de la apelación.
- Hay controles de autorización contra suspensiones o cambios no autorizados.

## Avisos de comentarios y respuestas: apagados por defecto

**Antes:** solo había avisos por mención (ADR 0063).

**Decisión del propietario:**
- En V1 vienen apagados por defecto.
- La persona puede activarlos.
- Hay un límite diario configurable.
- No compiten con las alertas de incidentes y emergencias.

## Estado de lanzamiento por país: se aplica

**Antes:** `launchStatus` existía en `data/countries/country-config.json` (Perú `PILOT`; el resto,
`AVAILABLE_READ_ONLY` por defecto), pero no se aplicaba.

**Decisión del propietario:**
- Solo se aceptan reportes ciudadanos en países `PILOT` o `AVAILABLE`.
- En cualquier otro estado, los reportes ciudadanos quedan en solo lectura.
- El control se aplica en el backend, no solo en la interfaz.
- La configuración es global, sin lógica exclusiva de Perú en el núcleo.

## Uso sin cuenta: solo lectura

**Antes:** la app abría «Entrar» una vez por arranque, pero se podía cerrar y seguir leyendo (ADR 0171). Escribir
pedía cuenta y edad.

**Decisión del propietario:**
- Sin sesión se puede consultar el contenido público, solo para leer.
- Sin sesión no se puede publicar, comentar, reportar ni hacer nada que requiera identidad.
- Las mismas reglas valen en la API, el backend y la app.

## Alternativas descartadas (contexto del expediente del 2026-10-10)

| Decisión | Descartado |
| --- | --- |
| D1 | 24 horas; 30 días para todo |
| D2 | Separar con presencia ALTA y cola con MEDIA; siempre a la cola |
| D3 | Nada público; puntaje completo |
| Suspensiones | Sin vencimiento |
| Avisos sociales | Encendidos por defecto; fuera de V1 |
| Lanzamiento por país | No aplicarlo en V1 |
| Uso sin cuenta | Exigir cuenta para todo |

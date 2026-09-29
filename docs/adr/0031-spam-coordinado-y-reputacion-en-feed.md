# ADR 0031 — Spam coordinado y reputación en la visibilidad del feed

- Estado: Aceptado · Fecha: 2026-09-29 · Blueprint §8.4, §13.3, ADR 0017, ADR 0020, ADR 0023

## Contexto
La reputación (ADR 0023) ya pesaba al corroborar, en el cupo de reportes y en las denuncias, pero no en lo que
se ve en "Para ti". Tampoco se detectaba el mismo mensaje pegado por varias cuentas (granjas, estafas de
"donaciones"), una forma común de spam en emergencias.

## Decisión
- **Huella de texto**: sin tildes, minúsculas, solo letras y números (`textFingerprintBase` en contracts), sha256
  en `social.posts.text_hash`. Textos de menos de 25 caracteres no cuentan ("ayuda", "se cayó").
- **Spam coordinado**: si el mismo hash lo publican ≥ 3 autores distintos en 24 h, `DuplicateTextDetected`
  abre (o suma a) un caso de moderación por cada post (máx. 50), motivo SPAM, como señal del sistema. **Nada
  se oculta solo**: un aviso real reenviado de buena fe también coincide, y decide una persona.
- **Reputación en el feed**: Trust mantiene `trust.standing` (solo "LOW sí/no") y publica
  `AuthorStandingChanged` cuando cambia (al registrar sanciones, reversiones, resultados de eventos o reportes
  nuevos). Social lo proyecta en `social.profiles.low_trust` y "Para ti" resta 12 h a los posts de esos autores.
  Siguen visibles en perfil, etiqueta, cercanos y siguiendo; nunca se muestra la reputación.
- Una tarea diaria del worker recalcula a quienes están en LOW (las sanciones caducan a los 90 días sin evento).
- Sin IA ni servicios de pago; los umbrales son constantes versionadas en código (`DUPLICATE_TEXT`,
  `RANK_BOOST_HOURS.lowTrustAuthor`).

## Consecuencias
- Moderación ve campañas de texto repetido aunque nadie las denuncie.
- Un autor con reputación baja pierde alcance, no voz. Los negocios no tienen este ajuste (tienen su propia
  verificación y moderación, ADR 0028).
- Pendiente de decidir por producto: ocultar automáticamente campañas grandes (hoy no se hace).

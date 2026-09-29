# ADR 0109 — PTWC como fuente externa y retraso de 5 minutos para violencia, editable por administración

Estado: aceptada (2026-09-29). Decisiones del propietario del mismo día.

## Contexto
- ADR 0060 registró PTWC como fuente OFICIAL para `natural.tsunami` (D-PTWC). El propietario decide ahora que PTWC
  no es fuente oficial nacional para Perú: una fuente solo confirma oficialmente cuando administración la registra y
  autoriza para una categoría y jurisdicción.
- ADR 0099 dejó el retraso de publicación de `crime.violence` a la espera de un valor. El propietario fija 5 minutos
  y pide que administración pueda cambiarlo.

## Decisión
- **D-PTWC-2**: `ptwc-tsunami` pasa a `type`/`trustTier` EXTERNAL (registro `sources-2026.09.7`). Sus alertas
  corroboran (EXTERNALLY_CORROBORATED) y pueden promover a URGENT, pero nunca producen OFFICIALLY_CONFIRMED. Las
  fuentes oficiales siguen siendo las del registro con ámbito (país + categorías) y los perfiles institucionales con
  ámbito que asigna administración (ADR 0095).
- **Retraso de violencia**: `crime.violence.publishDelayMinutes = 5` en el catálogo (`categories-2026.09.2`).
  Afecta solo a la publicación pública: el reporte se recibe, guarda, protege y audita en el acto; llamar a
  emergencias y retirar el reporte no esperan.
- **Editable sin desplegar**: tabla `event.category_settings` (migración 0046) y
  `GET|PUT /v1/admin/categories/:code/publish-delay` (`{ minutes: 0–1440 }`, solo rol admin, solo categorías
  HIGHLY_SENSITIVE, guarda quién y cuándo). `EventService.publishDelayFor` usa el ajuste si existe y si no el
  catálogo; se lee por clave primaria en cada reporte, así todas las instancias lo ven al momento. NO AI REQUIRED.

## Consecuencias
- Los eventos de tsunami solo quedan confirmados oficialmente por una fuente oficial peruana registrada (IGP/DHN),
  todavía en espera de sus datos.
- Las otras tres decisiones del mismo mensaje ya estaban implementadas: archivado a los 7 días de RESOLVED
  (ADR 0061), botón Llamar al número por país y categoría (datos de `emergency-numbers`) y push por mención con
  horas de silencio y preferencias (motor de alertas).

# ADR 0318 — Ubicación precisa: 7 días en categorías sensibles (D1)

- Estado: Aceptado
- Fecha: 2026-10-11
- Relación con el Blueprint: §13.2 (privacidad), decisión D-06; decisión D1 aprobada en ADR 0315; ADR 0004, 0048, 0316
- IA: **NO AI REQUIRED**. Costo: 0. Sin migraciones.

## Contexto

Cada reporte guarda cifrada la posición del teléfono (`report.presence_evidence.device_fix_enc`, ADR 0048). Hasta
ahora se borraba a los `PRESENCE_RETENTION_DAYS` días (30) en todas las categorías. El propietario aprobó el
2026-10-11 que en las categorías sensibles se guarde 7 días, con el plazo configurable (D1, ADR 0315).

## Decisión

**Plazos.**
- Categorías `SENSITIVE` y `HIGHLY_SENSITIVE` (hoy `crime.*` y `emergency.missing_person`):
  `SENSITIVE_PRESENCE_RETENTION_DAYS`, 7 por defecto.
- Resto: `PRESENCE_RETENTION_DAYS`, 30 por defecto (sin cambios).
- El plazo sensible no puede superar el general. Si se configura así, la API y el worker no arrancan.
- Una categoría puede acortar su plazo en los datos con `presenceRetentionDays` (`data/categories/categories.json`).
  Ese dato nunca alarga el plazo que toca por sensibilidad. Hoy ninguna categoría lo usa.

**Borrado.**
- `expires_at` se fija al recibir el reporte con el plazo de su categoría.
- El trabajo diario `retention.presence.generalized` primero acorta `expires_at` en las filas sin generalizar cuyo
  plazo actual es más corto que el guardado. Así, las filas guardadas con 30 días antes de este cambio, o antes de
  acortar la configuración, se borran a los 7 días de haberse recibido. Nunca alarga un plazo ya fijado.
- Después borra el dato cifrado y el dato en claro heredado, y deja solo la celda H3 r7 para estadística y antiabuso.
- Si la persona borra el reporte o su cuenta, la posición se borra en el momento (sin cambios).

**Lo que no cambia** (ya estaba y queda cubierto por pruebas):
- Cifrado por columna con claves rotables (ADR 0048).
- Solo moderación puede ver la posición, con motivo obligatorio, registro auditado y límite por hora
  (`POST /v1/moderation/posts/:id/presence`).
- Minimización: el punto público de un evento sensible es el generalizado por sensibilidad. La posición del teléfono
  nunca sale en perfiles, publicaciones, mapas ni exportaciones públicas. La única salida es la exportación de datos
  de la propia persona, que solo ve su propio dato (ADR 0256, 0316).

## Excepciones de conservación por ley

**BLOCKED_BY_LEGAL.** No se implementa ninguna excepción. Hace falta asesoría legal para saber si alguna norma obliga
a conservar la posición más tiempo (por ejemplo, una orden de conservación de una autoridad). Mientras tanto:
- Las solicitudes de autoridades solo se registran (decisión del 2026-09-29). No hay procedimiento de entrega.
- No existe un mecanismo de retención legal. Si la asesoría lo exige, pide una decisión nueva y su propio ADR.
- Las copias de seguridad de la base guardan el dato cifrado hasta que caducan. Su plazo se fija al crear la
  infraestructura (D-18) y debe documentarse junto con este.

## Pruebas

`test/sensitive-presence-retention.test.ts`:
- 7 días en `crime.theft` y `crime.violence`, 30 en `accident.traffic`; cada uno se borra a su plazo y la celda r7 queda.
- Una fila guardada con 30 días en una categoría sensible se ajusta a 7 y se borra al octavo día.
- El evento, sus publicaciones, su línea de tiempo, la publicación y el mapa no contienen la posición exacta.
- La configuración rechaza un plazo sensible mayor que el general.
- El dato por categoría acorta el plazo y no puede alargarlo.

## Consecuencias

- Moderación tiene 7 días para revisar la presencia de un reporte sensible. Después solo queda la celda r7.
- La rotación de claves (`docs/runbooks/rotacion-de-claves.md`) sigue dependiendo del plazo más largo, el general.

# ADR 0154 — Preferencias de alerta por zona guardada

- Estado: aceptada (2026-09-29) · AI_REQUIRED: no · COST: ninguno

## Contexto

§7.3 define `SavedPlace.alert_prefs`. Las zonas guardadas (ADR 0022) avisaban de todo lo que caía en su radio;
la gravedad mínima y las categorías solo existían a nivel global o por suscripción de área. "Casa: todo" y
"Colegio de mi hija: solo sismos e incendios graves" no se podían expresar.

## Decisión

- Migración 0069: `alert.zones.min_severity` (1–5, por defecto 1) y `categories` (text[], vacío = todas; una raíz
  cubre sus hijas; máximo 20). Las zonas existentes siguen avisando de todo.
- `SavedZoneInput`/`SavedZone` llevan `minSeverity` y `categories`; el servidor valida los códigos contra el
  catálogo y los guarda sin duplicados.
- El destinatario SAVED_ZONE del motor de alertas filtra en SQL por gravedad y categoría de la zona; las
  preferencias globales se siguen aplicando encima. "Cerca de mí" y las suscripciones no cambian.
- App: la pantalla de zona tiene gravedad mínima y categorías (raíces del catálogo del país) y ahora también edita
  (`zone-edit?id=`); la lista de zonas muestra el resumen del filtro. Se incluye en la exportación de datos.

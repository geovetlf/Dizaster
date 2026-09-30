# ADR 0160 — Gravedad del evento recalculada desde su evidencia

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno (una consulta por cambio de evidencia)

## Contexto

La gravedad (1–5, §7.3) se fijaba al crear el evento y después solo podía subir (`greatest(severity, hint)`).
Una fuente que corregía su dato (USGS revisa la magnitud) no cambiaba nada, porque la misma evidencia no se volvía a
procesar; una fuente retirada tampoco bajaba la gravedad; y moderación no tenía forma de corregirla (§5.7, §10.1).

## Decisión

- Cada evidencia guarda su propia gravedad (`event.evidence.severity`, migración 0073, con relleno desde los ítems
  normalizados ya ingeridos). Solo la traen las fuentes; un reporte ciudadano no la fija.
- Regla determinística (`severityFromEvidence`, NO AI REQUIRED), sobre la evidencia ACTIVA que afirma el evento:
  corrección de moderación → la fuente OFICIAL más reciente con gravedad → la mayor de las demás fuentes →
  gravedad por defecto de la categoría. Puede bajar.
- Se recalcula con cada cambio de evidencia (alta, retiro, moderación, fusión, reversión, división) y cuando una
  fuente revisa un ítem ya ingerido (la evidencia existente actualiza su gravedad).
- Si cambia: entrada `SEVERITY_CHANGED` en la línea de tiempo pública (de, a, causa) y evento de dominio
  `EventSeverityChanged`. Alertas reevalúan (si sube a alta, `SEVERITY_UP` como antes; si baja, no avisa) y el feed
  actualiza su señal. Carril urgente si sube, normal si baja.
- Corrección de moderación: `POST /v1/moderation/events/:id/severity {severity: 1..5 | null, reason}` (rol
  verificador), con motivo obligatorio y registro en `event.severity_log`. `null` quita la corrección y vuelve a
  mandar la evidencia. La ficha de moderación muestra la gravedad vigente, si está corregida y el historial; la app de
  moderación tiene los botones "Según la evidencia", 1…5.

## Consecuencias

- Fusionar ya no arrastra la gravedad del duplicado como "pista": el destino la recalcula desde la evidencia unida.
- Un cambio del valor por defecto de una categoría (catálogo remoto) mueve la gravedad de eventos sin fuentes la
  próxima vez que reciben evidencia.

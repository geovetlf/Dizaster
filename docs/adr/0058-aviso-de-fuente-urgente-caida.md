# ADR 0058 — Aviso cuando una fuente urgente cae o se recupera

- Estado: Aceptado · Fecha: 2026-09-29 · Blueprint §9.2 ("el carril URGENT nunca se desactiva en silencio")

## Decisión
- Cuando el circuit breaker de una fuente con carril URGENT se abre (3 fallos seguidos), el planificador publica
  `SourceHealthChanged {state: DEGRADED}` con el error resumido y la hora del próximo intento. Cuando vuelve a
  responder tras haber estado abierta, publica `RECOVERED`. Una vez cada transición: no repite mientras sigue caída.
- El consumidor deja un log estructurado (`ingestion.source.health`) y envía push a administración en su idioma, con
  enlace al panel de calidad. Usa el mismo canal que los avisos de presupuesto (ADR 0026).
- Las fuentes solo NORMAL no avisan: un día de retraso no pone a nadie en riesgo, y el panel de calidad ya muestra
  sus corridas fallidas.

## Fuera de alcance
- Detectar que el propio worker dejó de correr necesita un vigilante externo (healthcheck del orquestador o de
  uptime). Queda para cuando exista el entorno de producción.

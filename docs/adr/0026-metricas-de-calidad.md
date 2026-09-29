# ADR 0026 — Métricas de calidad del producto y aviso de presupuesto a administración

- Estado: Aceptado · Fecha: 2026-09-29 · Blueprint RNF-01/02/03, §5.18, §14

## Decisión
- **Tablero de calidad** `GET /v1/admin/quality?days=1..90` (solo administración), pantalla `admin-quality`
  en la app (iOS y Android, sin panel web) y CLI `pnpm quality:report [días] [--json]`. Solo cifras agregadas:
  ningún dato personal ni ubicación.
- Módulo `quality` **sin esquema propio**: pide a cada módulo sus agregados por su interfaz pública
  (`qualityStats` en event, verification, alert, ingestion y moderation) y los junta. No cruza esquemas.
- **Latencia de la API** como histograma por tramos (25, 50, 100, 200, 300, 500, 1000, 2000, 5000 ms y "más")
  dentro del medidor de uso existente (`cost.usage_daily`, módulo `http`, métricas `latency_le_<ms>`): a lo sumo
  10 filas por día, sin tabla nueva ni escritura por petición. Los percentiles se estiman con el techo del
  tramo (conservador).
- **Objetivos** (constantes en `modules/quality`; cambiarlos es una decisión):
  - API p95 ≤ 300 ms.
  - Cadena urgente oficial p95 ≤ 120 s: demora de ingesta urgente (publicación → llegada) + demora del push
    crítico (alerta → push). Se suma por tramos porque cada tramo vive en su módulo; es una cota superior.
  - Ningún caso de moderación abierto más de 24 h.
  - Un objetivo sin datos se muestra "sin datos", no como cumplido (salvo moderación sin casos abiertos: 0 h).
- **Calidad medida**: EVENTs creados y fusionados (duplicados que la resolución no evitó), primera llegada a
  cada estado de verificación y mediana hasta la primera corroboración, alertas y destino de cada aviso,
  corridas de ingesta fallidas, cola de moderación y apelaciones revertidas.
- **Aviso push a administración** cuando un presupuesto cruza 50/80/100 % (`BudgetThresholdReached`): va a los
  dispositivos de quienes tienen rol `admin`, en su idioma, con enlace `dizaster://admin-cost`. No entra al
  historial de alertas públicas. Es idempotente porque `cost` publica cada umbral una sola vez por periodo.

## Alternativas descartadas
- Prometheus/Grafana u otro servicio de observabilidad: costo y operación extra; se reconsidera con tráfico
  real. El histograma en el medidor basta para la V1.
- Una tabla por petición: una escritura por request, justo lo que el medidor evita.

## Consecuencias
- El tablero de costo muestra también las métricas `latency_*` bajo `http` (sin precio).
- El aviso a administración depende de las mismas credenciales de APNs/FCM que las alertas.

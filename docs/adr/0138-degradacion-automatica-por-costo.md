# ADR 0138 — Degradación automática por costo fuera de IA

- Estado: aceptada (2026-09-29, decisión del propietario: "Recomendadas", opción A)
- AI_REQUIRED: no · EXTERNAL_API_REQUIRED: no · COST: ninguno (una consulta por hora) · PRIVACY_IMPACT: ninguno

## Contexto

Los presupuestos de IA, SMS y traducción ya se cortan con CostGuard (ADR 0026). La infraestructura propia (almacenamiento
de media, video, ingesta) no tenía freno automático: solo avisos y kill switches manuales.

## Decisión

- Nuevo presupuesto `infra` (opcional; sin él no se degrada nada). Su "gastado" es la estimación del periodo: uso medido
  (`cost.usage_daily`) × precios de referencia (`data/cost/prices.json`) + almacenamiento prorrateado.
- Escalera fija, en este orden (decisión del propietario), en `DEGRADATION_LADDER` de contracts:
  1. 100 %: se apaga `video`.
  2. 110 %: se apaga `media-upload` (fotos nuevas).
  3. 125 %: se apaga `ingestion-normal` (carril NORMAL de fuentes; el URGENT sigue).
- Nunca se apagan por costo: reportes, alertas, push, fuentes urgentes, llamadas de emergencia.
- `cost.kill_switches.auto` distingue lo que apagó la regla. Al bajar el gasto, la regla solo restaura lo que ella apagó;
  si una persona toca un interruptor, deja de ser automático y queda como lo dejó.
- Avisos: `BudgetThresholdReached` al 50/80/100 % (una vez por periodo) y `CostDegradationChanged` en cada cambio, con push
  a administración y operación (texto en es/en/pt/fr).
- El worker evalúa la escalera cada hora (`CostService.applyDegradation`).

## Consecuencias

- Un gasto descontrolado degrada funciones caras en vez de cortar el servicio.
- Los porcentajes son datos en contracts; cambiarlos es un cambio de código revisado, no una opción de administración (V1).

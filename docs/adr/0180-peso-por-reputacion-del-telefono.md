# ADR 0180 — La reputación del teléfono ajusta el peso de la evidencia

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

§8.2 ("reputación del dispositivo y del usuario: ajusta el peso") y §13.3 ("afecta pesos, cuotas y visibilidad").
ADR 0131 aplicó la reputación del teléfono solo al cupo: un reporte desde un teléfono con ubicación simulada repetida o
con una cuenta suspendida seguía corroborando con el peso completo de la cuenta.

## Decisión

- `TrustService.contributionWeights` recibe los dispositivos de cada persona en ese evento y aplica `withPhone`
  (misma regla que el cupo): si alguna cuenta del teléfono está suspendida o hubo 3 reportes con señales de
  manipulación en 30 días, esa persona pesa como LOW en la corroboración.
- Las señales las calcula el módulo de reportes (`ReportService.phoneSignals`, dueño de esos datos) y Trust las recibe
  por una función inyectada, sin leer otro esquema. El cupo de ADR 0131 usa el mismo cálculo.
- `TRUST_RULES_VERSION = "trust-3"`.

## Consecuencias

- Ajusta el peso, no la validez: el reporte sigue publicado y cuenta, con menos fuerza.
- ADR 0131 queda ampliado: la frase "Solo ajusta el cupo" deja de aplicar.

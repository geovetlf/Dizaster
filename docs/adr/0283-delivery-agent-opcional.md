# ADR 0283 — Delivery Agent opcional: propone, no decide

- Estado: Aceptado
- Fecha: 2026-09-30
- Relación con el Blueprint: §20.23 (niveles de autonomía); ADR 0260, 0262, 0277
- IA: no (el agente actual es de reglas). Costo: 0.

## Contexto

La instrucción del 2026-09-30 19:32 pide:

- una interfaz para un Delivery Agent;
- que sea opcional;
- que no pueda saltarse los gates;
- una versión local y determinística si es posible.

Además, desde el 2026-09-30 el Delivery Control Plane no depende de ningún servicio externo de orquestación.

## Decisión

1. **Interfaz.** `DeliveryAgent.propose(contexto)` devuelve pasos de una lista cerrada de comandos de `dzd` y, si
   corresponde, un punto de parada con lo que necesita (persona, revisión o aprobación del propietario). El
   contexto incluye el impacto del cambio, la política, el entorno, el digest y el último resultado. El agente no
   ejecuta nada.
2. **Ejecutor (`validateProposal`).** No confía en el agente:
   - acepta solo comandos de la lista y solo las banderas permitidas por comando;
   - rechaza valores que parecen banderas;
   - impone la identidad `agent:<nombre>`, así que el agente no puede declararse `human`;
   - vuelve a decidir cada paso con el nivel de autonomía y el resultado de la política;
   - agrega `--execute` solo si quien invoca lo pidió y la autonomía lo permite;
   - detiene todo lo que sigue a un paso denegado.
3. **Separación de responsabilidades.** El agente decide qué hacer. Dónde se hace (imagen, proyecto, región, URL,
   archivo de variables) lo pone quien invoca. Un agente no puede apuntar a otra imagen ni a otro proyecto.
4. **Doble barrera.** Cada comando que ejecuta el agente vuelve a pasar su propio `guard` en el CLI. `isHuman` nunca
   acepta `agent:…`. Por eso llamar a `dzd deploy --actor agent:x` directamente también queda denegado por debajo
   del nivel 4.
5. **`RuleAgent`** es determinístico:
   - propone política, gates, documentación, IAM si cambió la infraestructura, firma, despliegue gradual y SLO;
   - tras un rollback o un rechazo solo propone el diagnóstico;
   - no despliega cuando el cambio es solo de documentación o no hay imagen;
   - en producción se detiene donde la política pide al propietario.
6. **Un agente con IA** implementaría la misma interfaz detrás del AI Core, apagado por defecto (ADR 0110, 0280).
   Nada lo requiere.

Con el nivel vigente (2, desarrollo autónomo), el agente propone y corre verificaciones. No despliega staging hasta
que el propietario suba el nivel a 4, y nunca promueve a producción sin el propietario.

## Uso

```sh
pnpm dzd agent --env staging --digest sha256:…      # muestra el plan y qué está permitido
pnpm dzd agent run --env local --digest sha256:… --env-file local.env --url http://127.0.0.1:8088 --execute
```

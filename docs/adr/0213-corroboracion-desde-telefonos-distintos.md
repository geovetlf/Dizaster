# ADR 0213 — Publicar un evento pendiente exige personas en teléfonos distintos

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

§8.2: un reporte con presencia media crea un evento "pendiente de corroboración" que no se publica hasta que lo
respalda otra persona (ADR 0099). §10.2 pide que la corroboración venga de dispositivos distintos, y ADR 0068
identifica el teléfono físico (`phoneId`). La verificación ya cuenta una vez por persona y por teléfono
(`bestWindowWeight`, ADR 0081), pero la publicación contaba solo cuentas distintas. Dos cuentas en el mismo teléfono
bastaban para sacar al mapa un evento pendiente.

## Decisión

- `independentContributors` (pura, en el módulo de eventos) cuenta una vez por persona y una vez por teléfono, con
  la misma regla que la verificación. Sin teléfono conocido, cuenta solo la persona.
- `recomputeAggregates` usa ese número para `nextPublication`.

## Consecuencias

- Un evento pendiente solo se publica con otra persona en otro teléfono, o con una fuente externa u oficial.
- Prueba `independent-contributors.test.ts`: la regla pura, y el caso completo de dos cuentas en un teléfono (sigue
  pendiente) frente a un tercer teléfono (se publica).

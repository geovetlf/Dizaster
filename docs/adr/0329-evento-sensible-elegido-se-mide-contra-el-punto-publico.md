# ADR 0329 — Al elegir un evento sensible, la distancia se mide contra su punto público

- Estado: Aceptado
- Fecha: 2026-10-11
- Relación con el Blueprint: §8.4 (deduplicación), §13.2 (ubicación); ADR 0109, 0156, 0179
- IA: **NO AI REQUIRED**. Costo: 0. Sin migración.

## Contexto

Al reportar sobre un evento concreto (`targetEventId`, también en los contra-reportes), el servidor comprobaba que el
pin estuviera a menos de `max(dedupRadiusM × 1,5, presenceRadiusM)` del punto **preciso** del evento.

En un evento `SENSITIVE` o `HIGHLY_SENSITIVE` el punto público está generalizado (celda H3) para no delatar el lugar
exacto, que sale de los pines de quienes reportaron. Un contra-reporte rechazado responde «El evento está demasiado
lejos del lugar del reporte» (422) sin crear nada. Probando pines, una cuenta podía acotar el punto preciso, que es
justo lo que la generalización protege.

## Decisión

- En eventos `SENSITIVE` y `HIGHLY_SENSITIVE` la distancia se mide contra `public_geom`, y el máximo suma el margen de
  generalización de su sensibilidad (`generalizationMarginM`). Es el mismo margen que ya usa «¿Es este el mismo
  evento?» (`/v1/events/nearby`). Aceptar o rechazar depende solo de lo que ya es público.
- En eventos `NORMAL` no cambia nada.

## Pruebas

`test/sensitive-target-oracle.test.ts`, con un evento subido a `HIGHLY_SENSITIVE`:
- un contra-reporte cerca del punto público pero lejos del preciso se acepta;
- uno más allá del margen del punto público se rechaza.

## Consecuencias

- Un reporte puede sumarse a un evento sensible desde algo más lejos (como mucho el margen de su celda). Es coherente
  con la lista de eventos cercanos, que ya los ofrecía con ese margen.
- Riesgo residual: la deduplicación automática (sin `targetEventId`) sigue midiendo contra el punto preciso, y la
  respuesta dice a qué evento se sumó el reporte. Acotar el punto por ahí exige crear reportes reales (cupo por hora
  y por teléfono, posts que ve moderación). Cambiarlo afecta a la calidad de la deduplicación: queda para decisión
  del propietario.

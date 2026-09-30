# ADR 0223 — Avisar a quien reportó cuando su evento cambia

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

§8.1 y §10.4 esperan que quien aporta evidencia sepa qué pasó con ella. Los avisos de cambio de un evento (se
corroboró, se confirmó, se marcó falso o en disputa, subió de gravedad, terminó) solo llegaban a quien lo seguía o
ya había recibido un aviso. Quien lo reportó no se enteraba salvo que lo siguiera a mano.

## Decisión

- Nuevo motivo de aviso `REPORTED` (migración 0094). Los avisos de cambio de estado, de gravedad y de fin, y las
  actualizaciones oficiales, incluyen a quien tiene un reporte no retirado en el evento.
- Prioridad del motivo: después de "sigues este evento" y antes de zonas, lugares y "ya te avisamos".
- Respeta sus preferencias: se apaga con "cambios de estado" o con el interruptor general, y cumple horas de
  silencio, agrupación y tope por hora como cualquier aviso.
- El módulo de reportes da la lista (`reportersOf`, máximo 1000) y el de avisos no lee su esquema.
- El texto del aviso es el mismo que ven los demás: no dice quién reportó.

## Consecuencias

- Reportar cierra el ciclo: la persona sabe si su reporte ayudó a confirmar o si resultó falso.
- Prueba en `alerts.test.ts`.

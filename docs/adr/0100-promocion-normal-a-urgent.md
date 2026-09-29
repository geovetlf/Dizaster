# ADR 0100 — Promoción NORMAL → URGENT por regla

- Estado: aceptada (2026-09-29).
- Blueprint: §9.2 ("Un ítem NORMAL de severidad alta puede promoverse a URGENT por regla"), §9.3 (OMS
  "NORMAL (promovible)")
- IA: **NO AI REQUIRED**. Costo: 0.

## Decisión

- **Regla por fuente.** Cada fuente puede declarar `config.promote` en el registro. Promueve si se cumple
  cualquiera de estas condiciones:
  - `minSeverity`: severidad normalizada (1 a 5) igual o mayor;
  - `categories`: la categoría del ítem o su raíz;
  - `keywords`: una palabra completa del título, en cualquier idioma, sin tildes ni mayúsculas. También admite
    frases como "yellow fever".
- **Aplicación.** El planificador aplica la regla además del `isUrgent` del adapter. Un ítem promovido se ingiere
  con carril URGENT: su evento y sus alertas van por la cola urgente.
- **Límites.**
  - Nunca se promueve un desmentido.
  - Sin regla, nada se promueve.
  - Una regla mal escrita (severidad fuera de 1 a 5, palabras de menos de 3 letras) se ignora.
- **OMS.** Queda con una regla de palabras para brotes de alta gravedad: ébola, Marburgo, peste, cólera, MERS,
  Nipah, H5N1 y fiebre amarilla. La fuente sigue en PLANNED (ADR 0092). Registro `sources-2026.09.6`.

## Consecuencias

- Pasar una fuente de NORMAL a promovible es solo configuración.
- Pruebas: `services/core/test/promotion.test.ts`, con la regla pura y el planificador con la muestra de la OMS.

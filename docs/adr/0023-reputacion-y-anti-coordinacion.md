# ADR 0023 — Trust & Safety: reputación por persona y detección de grupos coordinados

- Estado: Aceptado · Fecha: 2026-09-29 · Blueprint §9 (umbral "2 HIGH + reputación alta"), §13.3, ADR 0005, ADR 0020

## Decisión
- **Módulo `trust`** (esquema propio), alimentado solo por el outbox:
  - `EventEvidenceAdded` → registra quién aportó un reporte ciudadano a cada EVENT (`trust.contributions`).
  - `VerificationChanged` → guarda cómo terminó cada EVENT (`trust.event_outcomes`: confirmado, falso o pendiente;
    DISPUTED no cuenta porque aún no se sabe).
  - `ModerationActionTaken` → sanciones aplicadas por personas (ocultar, retirar, suspender); una apelación
    aceptada las revierte. Las reglas automáticas no cuentan como sanción. El evento ahora lleva
    `affectedUserId` y `reverses`.
- **Niveles** (reglas puras en `trust/rules.ts`, versión `trust-1`; nunca se muestran como número):
  - LOW: suspensión o ≥ 2 retiradas en 90 días, o ≥ 2 reportes de algo declarado FALSO y no más aciertos que eso.
  - NEW: cuenta de menos de 24 h.
  - TRUSTED: ≥ 30 días, ≥ 5 reportes en eventos que resultaron ciertos, ninguno falso y sin sanciones.
  - STANDARD: el resto.
- **Efectos**:
  - Peso al corroborar: NEW 0,5 · LOW 0,25 · STANDARD 1 · TRUSTED 1,5. Dos personas de confianza con presencia
    alta alcanzan el umbral 3 (la regla "2 HIGH + reputación alta" del Blueprint). Reglas de verificación
    pasan a `verification-2`.
  - Cupo de reportes por hora: NEW la mitad, LOW la cuarta parte (nunca cero).
  - Peso de las denuncias en la cola de moderación: el mismo, con tope 1.
- **Anti-coordinación**: dos cuentas de menos de 30 días que ya reportaron juntas en ≥ 2 otros eventos durante
  los últimos 7 días quedan enlazadas; cada grupo enlazado aporta solo su mayor peso. Se descartó agrupar por
  hora de creación de la cuenta: en un desastre real mucha gente instala la app a la vez, y eso castigaría
  corroboraciones genuinas.
- **Sin IP ni red**: no se guardan direcciones IP (minimización). La señal "misma red" queda fuera hasta que se
  decida si vale la pena guardar un hash con sal y retención corta.
- Al borrar una cuenta, sus filas de `trust` se conservan (antiabuso) y solo contienen el id interno.

## Consecuencias
- Sin coste externo; tres tablas pequeñas y consultas por índice.
- Pendiente: que la reputación afecte también la visibilidad en el feed, y señales de texto idéntico entre
  reportes de un mismo evento.

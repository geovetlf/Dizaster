# ADR 0060 — PTWC como fuente oficial y ámbito de las fuentes oficiales

- Estado: Aceptado · Fecha: 2026-09-29 · Decisión del propietario D-PTWC · Blueprint §9.3, §10

## Decisión
- Se registra `ptwc-tsunami` (Pacific Tsunami Warning Center, NOAA/NWS) como fuente OFICIAL, global (`*`), con una
  sola categoría: `natural.tsunami`. Usa el adaptador CAP existente (sin código nuevo) y carril URGENT cada 60 s.
- Regla general, no solo para PTWC: una fuente oficial confirma oficialmente solo dentro de su ámbito, es decir, la
  categoría del evento está en sus `categories` (o es hija de una raíz listada) y el país en su `countryScope`. Fuera
  de él su evidencia cuenta como externa (EXTERNALLY_CORROBORATED), nunca como OFFICIALLY_CONFIRMED.
- Lo mismo aplicará a DHN, IGP, INDECI, CENEPRED u otras autoridades: se agregan como datos en el registro de
  fuentes, sin tocar código ni fijar Perú en la arquitectura.
- AI_REQUIRED = NO · EXTERNAL_API_REQUIRED = feed público gratuito · COST = ZERO.

## Pendiente
- `status: PLANNED`: tsunami.gov no es accesible desde el entorno de construcción, así que la URL y el formato CAP
  del feed no están validados con una muestra real. Activarlo es cambiar el estado a ACTIVE tras validarlo.

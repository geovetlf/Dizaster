# ADR 0033 — Adapter genérico CAP 1.2 para alertas oficiales

- Estado: Aceptado · Fecha: 2026-09-29 · Blueprint §9.3, RF-14, ADR 0013

## Contexto
Las fuentes oficiales del piloto (IGP, INDECI, SENAMHI) están en RESEARCH sin adapter. CAP 1.2 (OASIS) es el
formato estándar de alertas públicas y lo usan muchos organismos; tener un adapter genérico hace que activar
una fuente CAP sea solo configuración en `data/source-registry`, en cualquier país.

## Decisión
- Adapter `cap-1.2`: acepta un `<alert>` suelto, un Atom/RSS con alertas incrustadas y el perfil Atom `cap:*`.
- Solo `status=Actual`. `Cancel`, `Ack` y `Error` no se registran (una cancelación retira la alerta; no
  desmiente el suceso). Un `Update` usa el identificador del mensaje original: actualiza el mismo ítem externo.
- **Categoría por configuración** (`eventMap`, palabra clave sin tildes): el texto de `event` es propio de cada
  emisor. Si no encaja, se ignora; nunca se adivina.
- Punto = centro de los vértices y círculos del área; incertidumbre = distancia al más lejano (mín. 1 km). Un
  área solo con geocódigo queda sin punto (IGNORED para el mapa), como cualquier ítem sin coordenadas.
- Severidad CAP → 1–5 (Extreme 5, Severe 4, Moderate 3, Minor/Unknown 2). Carril URGENT si la severidad llega
  a `urgentMinSeverity` (Severe por defecto) y la urgencia es Immediate o Expected.
- Probado con fixtures ficticios. Las fuentes peruanas siguen en RESEARCH: falta confirmar si publican CAP, su
  URL y revisar sus términos de uso (acción humana); con eso, activar es solo datos.

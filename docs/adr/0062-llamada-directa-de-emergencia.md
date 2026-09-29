# ADR 0062: Llamada directa según el registro de servicios de emergencia

- Estado: aceptada (decisión del propietario D-EMERGENCY-CALL, 2026-09-29)
- IA: **NO AI REQUIRED**. API externa: ninguna. Costo: 0.

## Contexto

Al reportar una categoría grave (severidad ≥ 4) la app mostraba "llama primero a emergencias" y abría la lista de
números. El propietario decidió que "Llamar" marque directamente el número que corresponde a la categoría cuando exista
y, si no, muestre la lista.

## Decisión

- El dataset `data/emergency-numbers/emergency-numbers.json` pasa a ser el **registro de servicios de emergencia**:
  - cada número tiene país, subdivisión (región/jurisdicción), servicio, número, etiqueta, fuente, verificación y ahora
    `availability` (`ALWAYS` | `LIMITED`, por defecto `ALWAYS`);
  - `routes` dice qué servicios atienden una categoría: `{country: "PE" | "*", subdivision, category: prefijo, services: [en orden]}`.
- `directEmergencyNumber()` (contracts, puro) elige la regla más específica (país concreto > "*", subdivisión > nacional,
  categoría más larga) y dentro de ella el primer servicio con número 24/7, prefiriendo el de la subdivisión. Sin
  resultado → la app abre la lista (`/emergency`).
- Las reglas globales ponen `GENERAL` primero: donde hay número único (112/911) se marca ese; donde no (Perú, Chile,
  Brasil, Japón…) se marca el del servicio (Perú: bomberos 116, policía 105, SAMU 106, Defensa Civil 115). Nada de esto
  está en el código: agregar un país o una región es editar el JSON.
- El país se calcula en el teléfono con el polígono de países (la ubicación no sale). Todo funciona sin conexión con el
  dataset empaquetado; `/v1/reference/emergency-numbers` ahora también entrega `routes`. Un dataset guardado antes de
  este cambio sigue siendo válido (sin rutas → lista).
- El botón muestra servicio y número ("Llamar a Bomberos · 116") para que se vea qué se marca, y debajo "Ver todos los
  números". Los números peruanos siguen `NEEDS_VERIFICATION`: contrastarlos con gob.pe es puerta de lanzamiento (ADR 0009).

## Consecuencias

- Un toque menos en el peor momento, sin costo.
- Regiones con números propios se agregan con `subdivision`; la app aún no calcula la subdivisión en el teléfono, así
  que hoy se usan los números nacionales.

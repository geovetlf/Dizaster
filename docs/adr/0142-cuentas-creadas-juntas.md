# ADR 0142 — Anti-coordinación: cuentas nuevas creadas juntas

- Estado: aceptada (2026-09-29) · AI_REQUIRED: no · COST: ninguno · PRIVACY_IMPACT: ninguno (solo fecha de alta)

## Contexto

§10.2 lista "cuentas nuevas creadas juntas" como señal de coordinación. ADR 0031 solo enlazaba cuentas jóvenes que
co-reportaron en 2 o más otros eventos recientes.

## Decisión

- Reglas `trust-2`: dos cuentas jóvenes (< 30 días) se tratan como un grupo si co-reportaron en 2 otros eventos
  recientes, **o en 1 si además se crearon con 10 minutos o menos de diferencia**.
- La fecha de alta sola NO enlaza: con muchas altas por día, y en un desastre todas a la vez, coincidir en el minuto
  de alta no prueba nada, y castigaría a testigos reales que instalaron la app por el evento.
- El prefijo de red (misma IP/red) NO se usa: decisión del propietario, hasta contar con asesoría legal.
- Función pura `coordinationLinks` en `trust/rules.ts`, probada por separado.

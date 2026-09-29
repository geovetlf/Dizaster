# ADR 0081 — Ventana de tiempo coherente en la corroboración comunitaria

- Estado: aceptada (2026-09-29)
- Blueprint: §10.2 (COMMUNITY_CORROBORATED: "… en ventana de tiempo coherente")
- IA: **NO AI REQUIRED**. Costo: 0.

## Contexto

`verification-2` sumaba el peso de todas las confirmaciones con presencia alta del evento sin mirar cuándo se
hicieron: tres reportes repartidos en varios días corroboraban igual que tres en diez minutos.

## Decisión

- Reglas `verification-3`: primero se deja una evidencia por persona y por dispositivo en todo el evento (como
  antes); después se busca la ventana de tiempo con más peso independiente (`bestWindowWeight`). Dentro de ella se
  siguen aplicando la reputación, los grupos coordinados y los textos idénticos (ADR 0023, 0074).
- La ventana es la de deduplicación de la categoría (`dedupWindowMinutes`, p. ej. 2 h accidente, 72 h incendio
  forestal): el mismo dato que ya define qué reportes son "el mismo suceso". No hay parámetro nuevo que calibrar.
- Aplica a confirmaciones y a desmentidos. La explicación de CITIZEN_CORROBORATION incluye `from` y `to` de la
  ventana ganadora (para §10.4, "5 personas entre 14:05 y 14:20").
- El nivel sigue siendo monótono: un evento ya corroborado no baja por este cambio.

## Consecuencias

- Pruebas: `services/core/test/verification-window.test.ts` y `verification.test.ts` (reportes separados dos días
  no corroboran).

# ADR 0225 — Una cuenta suspendida conserva sus avisos de seguridad

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

La suspensión (ADR 0041) deja leer y apelar, pero bloqueaba cualquier otra escritura. Eso incluía renovar el token
push, cambiar preferencias de avisos, zonas guardadas y ubicación aproximada. Tras reinstalar la app o rotar el
token, una persona suspendida dejaba de recibir alertas de desastres sin saberlo. Una sanción por conducta no debe
quitar la protección ante un peligro.

## Decisión

Además de lo ya permitido, una cuenta suspendida puede:

- registrar o quitar su token push;
- cambiar sus preferencias, suscripciones y zonas de avisos, y su ubicación aproximada;
- marcar avisos como leídos;
- seguir o dejar de seguir eventos y lugares (no personas ni negocios);
- bloquear o desbloquear a otras personas.

Nada de esto publica ni llega a otras personas. Una cuenta borrada no puede hacer nada de esto. Publicar, comentar, reaccionar, reportar y seguir perfiles siguen
bloqueados.

## Consecuencias

- La suspensión sanciona la conducta sin dejar a nadie sin alertas.
- Prueba en `suspended-safety.test.ts`.

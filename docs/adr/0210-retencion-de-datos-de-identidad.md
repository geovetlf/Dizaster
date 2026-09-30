# ADR 0210 — Retención de códigos de correo y fallos de MFA

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

§13.2 (minimización y retención corta). `identity.email_challenges` (inicio de sesión por correo, ADR 0170) guarda
HMAC del correo y, si hay, de la red de origen. Solo se consulta durante 1 h (límite por hora), pero nunca se
borraba. `identity.mfa_failures` (ADR 0042) solo se consulta durante 15 min (bloqueo) y solo se borraba al eliminar
la cuenta.

## Decisión

- `IdentityService.applyRetention` borra los códigos de correo y los fallos de MFA con más de 24 h: con margen, sin
  afectar a los límites que los usan.
- El worker lo ejecuta una vez al día junto con el resto de la retención y lo registra como `retention.identity`.
- Solo borra. No se añade ningún uso nuevo de la red (se mantiene ADR 0142).

## Consecuencias

- Esas tablas ya no crecen sin límite ni guardan datos más tiempo del necesario.
- Prueba `identity-retention.test.ts`.

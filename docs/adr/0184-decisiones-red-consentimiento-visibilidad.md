# ADR 0184 — Decisiones del propietario: señal de red, aceptaciones tras borrar la cuenta y visibilidad en V1

- Estado: aceptada (2026-09-30, decisiones del propietario) · AI_REQUIRED: no · COST: ninguno

## Contexto

Tres puntos quedaron PENDING DECISION tras ADR 0182. El propietario respondió el 2026-09-30.

## Decisión

1. **Señal de red compartida (§8.2): NO.** No se usa ninguna señal de red compartida (IP, prefijo, SSID, operador
   ni equivalentes) para detectar coordinación. Se mantiene ADR 0142 (cuentas creadas juntas, sin IP ni retención de
   prefijos de red). Cualquier mecanismo equivalente necesita una decisión nueva y revisión legal.
2. **Aceptaciones de términos al borrar la cuenta: SE CONSERVAN, mínimas.** Queda solo el id interno, documento,
   versión y fecha. Al borrar, `deleteAccount` vacía plataforma y versión de la app en la misma transacción.
   Migración 0088: el disparador de solo inserción permite exactamente ese vaciado y nada más.
3. **Visibilidad en V1: todo público.** Posts y perfiles públicos; sin posts solo para seguidores ni perfiles
   privados. Las columnas existentes (`social.posts.visibility` con `FOLLOWERS`/`PRIVATE`) quedan como preparación:
   la API no las acepta y todo se crea `PUBLIC`. El control de menciones (ADR 0137) sigue siendo la única opción de
   privacidad del perfil.

## Consecuencias

- Nada nuevo que recoger ni guardar. Prueba del punto 2 en `test/policy-acceptance.test.ts`.

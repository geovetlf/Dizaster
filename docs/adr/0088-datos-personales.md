# ADR 0088 — Detección determinista de datos personales → cola de moderación

- Estado: aceptada (2026-09-29)
- Blueprint: §13.3 (doxxing), §5.12 (IA solo si hace falta), ADR 0020, ADR 0031
- IA: **NO AI REQUIRED**. Costo: 0.

## Contexto

Publicar el teléfono, el documento o la tarjeta de otra persona (doxxing) está prohibido, pero solo llegaba a
moderación si alguien lo denunciaba. Hace falta una señal automática que no dependa de IA ni de un proveedor.

## Decisión

- `detectPersonalData(text, publicNumbers)` en `@dizaster/contracts` (compartido servidor/app). Solo devuelve los
  **tipos**:
  - `PHONE`: 8–15 dígitos con separadores típicos. No cuentan fechas, rangos de años, magnitudes, coordenadas ni
    los números del dataset de emergencias.
  - `EMAIL`.
  - `ID_DOCUMENT`: DNI, cédula, pasaporte, RUC, CPF, CURP, RUT, SSN, NIF/NIE o carné de extranjería seguidos de un
    código.
  - `PAYMENT_CARD`: 13–19 dígitos que pasan Luhn.
- Servidor: al crear un post o un comentario se publica `PersonalDataDetected` y moderación abre (o suma a) un caso
  **PRIVACY** con una nota que nombra los tipos y **nunca el dato**. Nada se oculta solo: el teléfono de un
  albergue o de una línea de ayuda es legítimo y lo decide una persona.
- Un negocio publica su propio teléfono y correo: en sus posts solo se revisan documentos y tarjetas.
- App: al escribir un post o un reporte, si el texto parece incluir datos personales se muestra un aviso antes de
  publicar (en el teléfono, sin red).

## Consecuencias

- Habrá falsos positivos (p. ej. un DNI que también parece teléfono); cuestan una revisión, no una publicación.
- Pruebas: `packages/contracts/test/personal-data.test.ts`, `services/core/test/personal-data.test.ts`.

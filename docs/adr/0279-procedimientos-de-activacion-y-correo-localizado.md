# ADR 0279 — Procedimiento de activación por bloqueo y correo de acceso en el idioma de la app

- Estado: Aceptado
- Fecha: 2026-09-30
- Relación con el Blueprint: §20 (activación), §5.1, Language Engine (ADR 0216); ADR 0170, 0277, 0278
- IA: **NO AI REQUIRED**. Costo: 0.

## Contexto

La instrucción del 2026-09-30 19:32 pide, para cada bloqueo externo, documentar qué falta y por qué, preparar todo lo
posible y escribir el procedimiento exacto de activación. Al revisarlos se encontró que el correo con el código de
acceso (ADR 0170) era el único texto de sistema enviado por el servidor solo en español: los avisos push ya salen en
es, en, pt y fr.

## Decisión

- `docs/runbooks/activacion-bloqueos.md`: un procedimiento por bloqueo. Cubre GitHub (acceso de la app), EXPO_TOKEN,
  proyectos y facturación de Google Cloud, base de staging, media, correo, atestación, CSAM, push y fuentes oficiales.
  Para cada uno separa qué hace el propietario (cuenta, dinero o decisión legal) y qué hace el agente, y cómo se
  verifica. Las credenciales van del propietario a Secret Manager o a GitHub, nunca al agente ni a OpenTofu.
- `EmailStartRequest.lang` es opcional; la app envía el idioma de su interfaz. El servidor elige asunto y cuerpo en
  es, en, pt o fr; sin idioma, español. Un idioma no soportado da 400. El correo no lleva datos de la persona.

## Consecuencias

- Cuando se elija el proveedor de correo, el adapter solo envía: el texto ya está localizado.

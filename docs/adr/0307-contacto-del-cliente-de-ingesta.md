# ADR 0307 — Contacto configurable en el User-Agent del cliente de ingesta

- Estado: Aceptado (falta el valor del propietario)
- Fecha: 2026-10-10
- Relación con el Blueprint: §9.3 (fuentes externas, uso respetuoso); ADR 0065, 0075
- IA: **NO AI REQUIRED**. Costo: 0.

## Contexto

El cliente HTTP de ingesta se identificaba con un User-Agent fijo, `Dizaster-Ingestion/0.1 (+contacto pendiente)`, y
la tarea figuraba como BLOQUEADA hasta que el propietario diera un correo o URL de contacto. El mecanismo no depende de
ese valor: solo el valor lo da el propietario.

## Decisión

- Variable `INGEST_CONTACT` en `services/core/src/platform/config.ts`: un correo o una URL `https://`, como máximo 200
  caracteres, sin espacios ni paréntesis (no puede romper el formato del User-Agent). Vacía = "contacto pendiente".
- `ingestionUserAgent(contact)` arma `Dizaster-Ingestion/0.1 (+<contacto>)` y `container.ts` lo pasa a
  `NodeHttpFetcher`.
- En producción (y staging, que corre con `NODE_ENV=production`) sin contacto, el servicio arranca, pero
  `dzd config-check` imprime un aviso. No se convierte en requisito de arranque para no sumar un bloqueo a staging.
- En la nube se carga por `extra_env` de `infra/tofu/envs/<entorno>`; no es un secreto.

## Consecuencias

- Cuando el propietario dé el contacto, basta con fijar la variable; no hace falta código.
- Pruebas: `services/core/test/ingestion-contact.test.ts` (formato, validación, aviso y la cabecera que llega a la
  fuente).

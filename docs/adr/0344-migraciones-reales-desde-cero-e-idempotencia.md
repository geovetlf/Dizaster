# ADR 0344 — Migraciones reales desde cero e idempotencia del migrador

- Estado: Aceptado
- Fecha: 2026-10-11
- Relación con el Blueprint: §13 (operación); ADR 0273 (candado y checksum del migrador)
- IA: **NO AI REQUIRED**. Costo: 0.

## Contexto

`migrate-runner.test.ts` prueba el migrador con archivos sintéticos. Las migraciones reales se aplicaban en cada
prueba sobre una base ya creada: `resetDatabase` borra los esquemas propios, pero no las extensiones ni la base. Nada
comprobaba tres cosas:
- que las migraciones reales funcionan sobre una base vacía (como el primer despliegue de staging);
- que volver a migrar no cambia nada;
- que la numeración no tiene huecos ni repeticiones.

## Decisión

`services/core/test/idempotency-migrations.test.ts`, sobre una base nueva y propia que se borra al final:
- La numeración de `migrations/` es 0001…N sin huecos ni repeticiones.
- Dos migradores a la vez sobre la base vacía aplican cada archivo una vez, en orden, y guardan el sha256 de cada
  uno.
- Dos ejecuciones más devuelven `[]` y no cambian:
  - la huella del catálogo (columnas, índices, restricciones, funciones, disparadores, vistas y extensiones);
  - el registro `platform.schema_migrations`.
- El candado de sesión queda libre. La consulta que lo comprueba se valida con el candado tomado.
- Una fila antigua sin checksum lo recibe sin reaplicar el archivo.

## Consecuencias

- El migrador no rechaza una migración aplicada cuyo archivo ya no existe. Es a propósito: un despliegue que vuelve a
  una imagen anterior tiene menos archivos que la base. Rechazarlo rompería la reversión del canario.

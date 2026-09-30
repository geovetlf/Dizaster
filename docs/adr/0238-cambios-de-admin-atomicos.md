# ADR 0238 — Cambios de administración y su registro en la misma transacción

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

Los presupuestos, los kill switches, la verificación de negocios y el ámbito institucional se aplicaban y después se
escribía `platform.config_changes` (ADR 0219) por separado. Si el registro fallaba, el cambio quedaba sin auditar, y
el valor "anterior" podía haber cambiado entre la lectura y la escritura. El retraso de publicación ya lo hacía bien.

## Decisión

- Las cuatro rutas leen el valor anterior, aplican el cambio y escriben el registro dentro de una transacción. Los
  servicios aceptan un `Queryable` opcional para participar en ella.
- Al quitar el sello institucional, el retiro de su fuente oficial va en la misma transacción.

## Consecuencias

- No hay cambios de configuración sin registro. Prueba en `config-changes.test.ts` (si el registro falla, ni el
  presupuesto ni el kill switch cambian).

# ADR 0262 — Políticas de entrega, permisos y niveles de autonomía

- Estado: Aceptado (diseño)
- Fecha: 2026-09-30
- Relación con el Blueprint: §20.16, §20.23, §20.5, §20.13, §20.15

## Contexto

La instrucción del propietario pide autonomía máxima para Claude con mínima intervención humana, pero acotada:
autonomía no es acceso ilimitado. Pide un motor de políticas configurable, límites explícitos (Permission Guard) y
niveles formales de autonomía auditados.

## Decisión

### Clases de riesgo (`delivery/policy.json`)

| Clase | Ejemplos (rutas y señales) | Resultado |
|---|---|---|
| Bajo | `docs/**`, `**/*.test.ts`, `apps/mobile/src/lib/locales/**`, UI no crítica, refactor sin cambio de contrato OpenAPI | `auto` |
| Medio | lógica de módulos no críticos, nuevas rutas de lectura, dependencias menores | `auto` en staging; `review` para producción |
| Crítico | `identity/**`, autorización/roles, `report/**` (presencia y ubicación), cifrado, `verification/**`, `alert/**`, emergencia, pagos/donaciones, `migrations/**`, `infra/**`, `.github/**`, `delivery/**`, cambios en guardas de `config.ts` | `approval` |
| Bloqueado | migración con `DROP`/`TRUNCATE` de datos no derivados, `tofu destroy` o reemplazo de recursos con estado, desactivar un gate o la auditoría, roles primitivos en IAM, secretos en el repo | `block` (solo el propietario puede autorizar por escrito una excepción puntual) |

La clase de un cambio es la más alta de sus archivos. Un cambio en la política misma es crítico. Los motivos quedan en
el informe del PR y en la auditoría.

### Permission Guard

Claude **puede:** leer el repositorio, escribir código, crear ramas, commits y PRs, ejecutar pruebas y herramientas
permitidas, disparar builds, desplegar desarrollo, y staging cuando los gates pasan (a través del Delivery Plane).

Claude **no puede** (ni el Delivery Plane en su nombre): obtener root u Owner, leer secretos, borrar producción,
modificar IAM maestro, desactivar gates de seguridad o auditoría, borrar respaldos, eliminar bases, saltarse
políticas, desplegar a producción directamente.

Cumplimiento técnico, no solo de palabra: Claude no tiene credenciales de nube; las identidades de despliegue solo
existen dentro de workflows condicionados por OIDC; `main` y los entornos están protegidos; la política vive en el
repositorio y sus cambios son críticos.

### Niveles de autonomía

Se adoptan los seis niveles propuestos (0 solo humano, 1 asistencia, 2 desarrollo autónomo, 3 validación y build
autónomos, 4 staging autónomo, 5 producción por política) con dos ajustes:

1. El nivel 3 incluye **merge automático** de PRs clase `auto` con todos los gates verdes: sin eso el propietario
   tendría que hacer merges a mano, que es justo lo que quiere evitar.
2. El nivel 5 nunca incluye `approval` ni `block` automáticos: migraciones con riesgo, IaC destructiva, gasto nuevo y
   cambios críticos siempre esperan al propietario.

Permisos por nivel: tabla en Blueprint §20.23. **Nivel actual: 2, sin GitHub** (el repositorio aún no existe, D-20).
Cada subida de nivel requiere que sus piezas estén implementadas y probadas y el visto bueno del propietario; bajar de
nivel es inmediato ante un incidente.

### Aprobación de producción sin costo

Mientras el plan de GitHub no ofrezca revisores obligatorios en entornos privados (D-24): la promoción a producción
solo corre desde una etiqueta de versión `v*` creada por el propietario (regla de protección de etiquetas) o desde
`workflow_dispatch` restringido a su cuenta; el workflow verifica que el digest sea el verificado en staging.

## Consecuencias

- La política es código revisable y auditable; el Delivery Plane la evalúa sin IA.
- La autonomía crece por niveles medibles, no por confianza implícita.

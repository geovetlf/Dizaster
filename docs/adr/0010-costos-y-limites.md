# ADR 0010 — Controles de costo y abuso activos desde el inicio

- Estado: Aceptado · Fecha: 2026-09-29 · Blueprint §12

## Decisión
- `CostGuard` con presupuestos a 0 y kill switches activados para IA, SMS y traducción: nada de pago se ejecuta hasta aprobar presupuesto.
- Límite de reportes por usuario y hora (`REPORTS_PER_HOUR_LIMIT`, 10 por defecto).
- Respuestas públicas con `cache-control` para CDN (config, referencia, mapa 30 s).
- Ingestión: solo fuentes `ACTIVE`; idempotencia por (fuente, id externo) y hash de contenido; crudo fuera de la base de datos.
- En producción el backend se niega a arrancar sin verificador real de atestación ni con el login de desarrollo activo.

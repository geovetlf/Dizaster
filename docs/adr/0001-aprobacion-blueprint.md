# ADR 0001 — Aprobación del Master Blueprint y modificaciones obligatorias

- Estado: Aceptado
- Fecha: 2026-09-29
- Relación: `docs/DIZASTER_MASTER_BLUEPRINT.md` §16

## Decisión
El propietario aprobó el Blueprint v0.1 y las decisiones D-01 a D-21 con estas modificaciones obligatorias:

1. POST, REPORT y EVENT son entidades distintas conceptual y técnicamente (ADR 0003).
2. Mapa: MapLibre + datos cartográficos abiertos + infraestructura propia; proveedor desacoplado por interfaz (ADR 0006).
3. Backend: PostgreSQL + PostGIS + H3, monolito modular; sin microservicios en V1 salvo justificación técnica real (ADR 0002).
4. Verificación: la IA analiza, clasifica, correlaciona, detecta duplicados y sugiere; nunca produce OFFICIALLY_CONFIRMED (ADR 0005).
5. Privacidad: evidencia de presencia privada; la ubicación pública se generaliza por categoría/riesgo/contexto; soporte de publicación seudónima (ADR 0004).
6. Estados: se mantienen los 4 niveles y se añaden DISPUTED y FALSE con trazabilidad, reglas y controles anti-abuso (ADR 0005).
7. Sharing: V1 solo app; deep links / universal links / app links; página técnica mínima solo si es estrictamente necesaria (ADR 0007).
8. Piloto: Perú, con arquitectura global desde el día uno (ADR 0008).

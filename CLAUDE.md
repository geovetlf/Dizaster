# Guía para agentes en este repositorio

- Dizaster es independiente de WEE y MelonOffice: nunca abrir, importar, conectar ni modificar nada de esos proyectos.
- V1 = solo app móvil. No construir web de producto.
- Antes de cambiar arquitectura, leer `docs/DIZASTER_MASTER_BLUEPRINT.md` y `docs/adr/`. Toda decisión nueva → ADR.
- Cost-first: ningún servicio de pago sin presupuesto aprobado; todo proveedor detrás de una interfaz.
- Backend: un módulo solo importa `../otro/index.js` y solo consulta su propio esquema (`pnpm check:boundaries`).
- Lo específico de un país es dato en `data/`, nunca código.
- La IA nunca produce `OFFICIALLY_CONFIRMED` ni `FALSE`.
- La ubicación precisa del reportero nunca sale por la API pública.
- Antes de dar algo por terminado: `pnpm check`.
- App móvil: seguir `apps/mobile/AGENTS.md` (Expo cambia en cada SDK).

# ADR 0314 — Base de staging en VM y fronteras del piloto

- Estado: Aceptado
- Fecha: 2026-10-10
- Relación con el Blueprint: §11.5 (geografía), §20 (entrega); decisiones D-17 y D-23; ADR 0016, 0261, 0278, 0308
- IA: **NO AI REQUIRED**. Costo: 0 en este cambio. No crea recursos ni autoriza gasto.

## Contexto

El propietario respondió dos decisiones el 2026-10-10, en tarjetas de decisión del proyecto:

| Decisión | Pregunta | Respuesta |
| --- | --- | --- |
| D-23 | «Decide dónde corre la base de datos de staging.» | **VM**: admite H3 y es la opción más barata |
| D-17 | «Decide qué fronteras en disputa usa el piloto.» | **Límites de Perú**: el piloto usa los límites oficiales de Perú; otro país se decide con asesoría legal |

Cloud SQL no tiene la extensión `h3` (ADR 0308), así que `cloudsql` habría exigido mover H3 a la aplicación.

## Decisión

**D-23: staging corre en una VM propia** (módulo `database-vm`, ADR 0278).
- `infra/tofu/envs/staging/main.tf` valida que `database.mode` sea `vm`. Cualquier otro modo falla en
  `tofu validate` con un mensaje que remite a este ADR. Volver a `cloudsql` o `external` pide una decisión nueva.
- `staging.tfvars.example` trae `mode = "vm"` y el bloque `vm`. Zona, tipo de máquina y disco siguen como
  marcadores: son decisiones de costo del propietario.
- La base de producción no se decide aquí.
- **Nada se crea.** Aplicar la IaC sigue esperando D-18 (proyectos, facturación y presupuesto). La VM es un recurso
  de pago y necesita esa autorización.

**D-17: el piloto usa los límites oficiales de Perú.**
- El índice administrativo de Perú (departamento, provincia y distrito) ya sale de los límites del INEI
  (`data/geo/datasets.json`, ADR 0016). No cambia.
- Los polígonos de país de Natural Earth (`data/countries/countries-50m.geojson`) solo sirven para saber en qué país
  está el teléfono. No se dibujan como frontera.
- El mapa base de OpenStreetMap (Protomaps, `infra/maps`) todavía no se publica: la subida está bloqueada por el
  almacenamiento. Antes de publicar el mapa de Perú hay que revisar cómo dibuja las fronteras de Perú y ajustarlo a
  los límites oficiales. Ese paso queda anotado en `infra/maps/README.md`.
- Abrir otro país con fronteras en disputa sigue esperando asesoría legal.

## Consecuencias

- `#3` (PostGIS 17) sigue bloqueado: la imagen local y la de CI deben coincidir con la base que se despliegue.
  Con la VM, la versión la fija la imagen `db` propia. Subir de versión pide su propio ADR.
- Siguen abiertas: D1, D2, D3, uso sin cuenta, estado de lanzamiento por país, duración de suspensiones y avisos
  sociales.

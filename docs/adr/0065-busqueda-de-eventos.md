# ADR 0065: Búsqueda de eventos

- Estado: aceptada (RF-02 "búsqueda"; Blueprint §5.3)
- IA: **NO AI REQUIRED**. API externa: ninguna. Costo: 0 (consultas a PostgreSQL ya existente).

## Decisión

- `GET /v1/search/events?q=&lat=&lng=&archived=0|1&limit=` (pública, como el mapa).
- Hasta 4 palabras (normalizadas sin tildes); **cada una** debe coincidir con algo del evento:
  - la categoría: nombre en cualquier idioma del catálogo (es/en/pt/fr), por prefijo de palabra; una categoría raíz
    ("Incendio") incluye sus subcategorías;
  - el lugar: áreas del índice geográfico propio cuyo nombre coincide, **más todas sus subdivisiones** (buscar "Lima"
    encuentra sus distritos), contra `region_id`/`district_id`; o el país por su nombre en es/en;
  - el título que trajo la fuente (p. ej. "M 5.1 - 20 km SW of Chimbote").
- Solo eventos publicados, no falsos, no fusionados. Archivados solo con `archived=1` (historial, ADR 0061).
- Orden: vigentes (ACTIVE/MONITORING) primero; luego cercanía a la ubicación aproximada del lector (2 decimales) o
  actividad reciente.
- Privacidad: devuelve el mismo `EventSummary` público del mapa. Un evento HIGHLY_SENSITIVE no guarda distrito público,
  así que no se lo encuentra por distrito.
- App: sección "Eventos" arriba en la pantalla de búsqueda.

## Alternativas descartadas

- Buscador externo (Algolia, Elastic gestionado): costo y un dato más fuera. Si algún día hace falta texto libre en
  posts, primero `tsvector` de PostgreSQL.
- Embeddings/IA: innecesarios para categoría + lugar.

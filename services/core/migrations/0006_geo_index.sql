-- Geo Engine: índice administrativo abierto (país → región → ciudad → distrito/zona).
-- Datos: polígonos abiertos importados (Natural Earth, límites oficiales abiertos por país). Sin APIs comerciales.
CREATE SCHEMA IF NOT EXISTS geo;

-- Cada importación deja constancia de origen, licencia y huella del archivo (trazabilidad de datos abiertos).
CREATE TABLE geo.datasets (
  id            text PRIMARY KEY,
  source        text NOT NULL,
  license       text NOT NULL,
  attribution   text NOT NULL,
  sha256        text NOT NULL,
  feature_count integer NOT NULL,
  imported_at   timestamptz NOT NULL DEFAULT now()
);

-- Áreas administrativas. level: 1 = región (ISO 3166-2), 2 = provincia/subregión, 3 = distrito/municipio.
-- Varias fuentes pueden cubrir el mismo nivel: gana la de mayor prioridad (p. ej. límites oficiales sobre Natural Earth).
CREATE TABLE geo.admin_areas (
  id          text PRIMARY KEY,                    -- estable y con espacio de nombres: "PE:150122", "NE1:JPN-1860"
  dataset_id  text NOT NULL REFERENCES geo.datasets(id),
  country     char(2) NOT NULL,
  level       smallint NOT NULL CHECK (level BETWEEN 1 AND 3),
  code        text,                                -- código oficial (ubigeo, ISO 3166-2…)
  name        text NOT NULL,
  names       jsonb NOT NULL DEFAULT '{}',         -- nombres por idioma cuando la fuente los trae
  search_key  text NOT NULL,                       -- nombre normalizado (minúsculas, sin tildes) para búsqueda
  parent_id   text,
  priority    smallint NOT NULL,
  geom        geometry(MultiPolygon, 4326) NOT NULL
);
CREATE INDEX admin_areas_geom_idx ON geo.admin_areas USING gist (geom);
CREATE INDEX admin_areas_country_level_idx ON geo.admin_areas (country, level);
CREATE INDEX admin_areas_search_idx ON geo.admin_areas USING gin (search_key gin_trgm_ops);

-- Localidades (puntos) para nombrar la ciudad donde no hay polígonos locales de ciudad.
CREATE TABLE geo.places (
  id          text PRIMARY KEY,
  dataset_id  text NOT NULL REFERENCES geo.datasets(id),
  country     char(2) NOT NULL,
  name        text NOT NULL,
  population  integer NOT NULL DEFAULT 0,
  geom        geometry(Point, 4326) NOT NULL
);
CREATE INDEX places_geom_idx ON geo.places USING gist (geom);

-- Memo por celda H3 r9 (~0,1 km²): la mayoría de eventos caen en celdas ya resueltas.
-- Se vacía en cada importación, así nunca sirve un contexto de datos antiguos.
CREATE TABLE geo.context_cache (
  cell       h3index PRIMARY KEY,
  context    jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Ubicación contextual del EVENT (derivada SOLO de su punto público ya generalizado).
-- Es un tercer nivel, distinto de la ubicación privada de presencia (report) y de public_geom.
ALTER TABLE event.events
  ADD COLUMN region_id   text,
  ADD COLUMN district_id text,
  ADD COLUMN place       jsonb;
CREATE INDEX events_region_idx ON event.events (region_id, last_activity_at DESC);
CREATE INDEX events_district_idx ON event.events (district_id, last_activity_at DESC) WHERE district_id IS NOT NULL;

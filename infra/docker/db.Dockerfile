# PostgreSQL 16 + PostGIS + H3 (todas open source). Misma base para desarrollo, CI y el primer despliegue.
FROM postgis/postgis:17-3.5@sha256:01a6a70e41e6c4467c8f55f6063555ed72db2d6662cd0d571040d42eadaeb6f6
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-16-h3 \
 && rm -rf /var/lib/apt/lists/*
# Sin root (ADR 0266): el entrypoint oficial admite correr como `postgres` si el directorio de datos es suyo, como en
# un volumen nuevo creado desde la imagen.
USER postgres

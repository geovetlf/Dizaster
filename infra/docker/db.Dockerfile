# PostgreSQL 16 + PostGIS + H3 (todas open source). Misma base para desarrollo, CI y el primer despliegue.
FROM postgis/postgis:16-3.4
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-16-h3 \
 && rm -rf /var/lib/apt/lists/*

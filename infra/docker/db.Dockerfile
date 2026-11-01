# PostgreSQL 16 + PostGIS + H3 (todas open source). Misma base para desarrollo, CI y el primer despliegue.
FROM postgis/postgis:18-3.6@sha256:4a43e3c3e5d55b9208240fc71db543b79c638766280c625a425bd0a2390989c4
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-16-h3 \
 && rm -rf /var/lib/apt/lists/*
# Sin root (ADR 0266): el entrypoint oficial admite correr como `postgres` si el directorio de datos es suyo, como en
# un volumen nuevo creado desde la imagen.
USER postgres

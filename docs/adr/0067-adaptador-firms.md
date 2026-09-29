# ADR 0067: Adaptador NASA FIRMS (focos de calor por satélite)

- Estado: aceptada. Activación **BLOQUEADA** hasta tener la MAP_KEY (gratuita, la pide el propietario).
- IA: **NO AI REQUIRED**. API externa: NASA FIRMS (datos abiertos, gratis con clave). Costo: 0.

## Decisión

- Adaptador `firms-csv` (formato CSV de la API "area" de FIRMS, VIIRS o MODIS):
  - cada foco es un candidato `fire.wildfire`; el Event Engine los agrupa por radio (5 km) y ventana (72 h) en un
    solo incendio;
  - id estable: satélite + fecha/hora de paso + coordenadas (FIRMS no da ids);
  - confianza VIIRS l/n/h o MODIS en %, llevada a baja/nominal/alta; se ingiere desde `minConfidence` (nominal);
  - severidad por potencia radiativa (FRP): <100 MW → 2, ≥100 → 3, ≥500 → 4. Nunca 5 por un satélite;
  - urgente con confianza alta y FRP ≥ `urgentMinFrp` (100 MW);
  - como mucho `maxItems` (2000) focos por descarga, los más potentes primero;
  - incertidumbre = medio píxel del sensor (mínimo 200 m).
- Confianza EXTERNAL (no oficial): un foco puede llevar un incendio a EXTERNALLY_CORROBORATED, nunca a
  OFFICIALLY_CONFIRMED.
- **Secretos de fuentes:** la URL en `data/source-registry` lleva `{secret:SOURCE_KEY_FIRMS}`; el valor sale del
  entorno (`SOURCE_KEY_*`), se codifica en la URL y se borra de cualquier mensaje de error guardado. Sin clave, la
  fuente falla con "Falta el secreto…" y el breaker la pausa.
- Área: rectángulo del país piloto (Perú) en la configuración. Otro país = otra entrada de datos.

## Limitaciones

- Fuentes de calor fijas (antorchas de gas, industrias) generan focos persistentes; si aparecen, se añadirá una lista
  de exclusión como datos por país.
- No se validó contra la API real (sin clave en este entorno); el formato sigue la documentación pública de FIRMS y
  se prueba con un CSV de ejemplo.

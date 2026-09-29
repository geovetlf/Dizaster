# ADR 0092 — Adapters del carril NORMAL: ReliefWeb, OMS DON y RSS de noticias

- Estado: aceptada (2026-09-29). Activación **en espera** de revisar términos.
- Blueprint: §9.3, §9.4, D-09, ADR 0060, ADR 0077
- IA: **NO AI REQUIRED**. Costo: 0 (APIs públicas, carril diario).

## Decisión

- **ReliefWeb (OCHA)** — `reliefweb-disasters-json`, API v2 `/disasters`:
  - fuente EXTERNA: corrobora, nunca confirma oficialmente;
  - solo desastres en curso de tipos GLIDE conocidos (inundación, sismo, ciclón, brote…);
  - solo trae el país, así que el punto es la ubicación del país con 250 km de incertidumbre (`precision: COUNTRY`);
  - guarda nombre, enlace y GLIDE, nunca el texto de los informes.
- **OMS — Disease Outbreak News** — `who-don-json`:
  - fuente OFICIAL solo para `health.outbreak` (D-09);
  - el país se saca del título ("Cholera – Haiti") con los nombres de región del propio motor Intl en
    en/es/fr/pt, más alias frecuentes, y se envía como geocódigo `ISO3166-1`;
  - el servidor lo ubica en un punto representativo del país (centroide del polígono mayor; si cae fuera, el punto
    interior más cercano de una grilla) con un radio amplio y sin área;
  - sin país reconocible, sin mapa.
- **RSS/Atom de noticias** — `rss-news`, fuente EXTERNA:
  - por derechos de autor solo guarda titular, enlace https y un resumen de 200 caracteres como mucho, sin HTML;
  - la categoría sale de palabras clave de la configuración de cada fuente;
  - la ubicación, solo de GeoRSS;
  - el idioma del titular se detecta localmente (ADR 0091).
- ReliefWeb y OMS quedan en el registro como **PLANNED** (versión `sources-2026.09.5`); no ingieren hasta
  activarlas.
- Ningún medio de noticias queda registrado: elegirlos es una decisión de producto y de derechos.

## Consecuencias

- Todo es carril NORMAL (`isUrgent` siempre falso).
- Pruebas: `services/core/test/normal-adapters.test.ts` con fixtures en `test/fixtures/`.

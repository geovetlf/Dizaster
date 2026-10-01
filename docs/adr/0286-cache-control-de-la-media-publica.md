# ADR 0286 — Cache-Control explícito para la media pública

- Estado: Aceptado
- Fecha: 2026-09-30
- Relación con el Blueprint: §5.9 (entrega por CDN), §12.1–12.2 (caché agresiva para controlar el egreso); ADR 0014, 0036
- IA: no. Costo: 0; baja el egreso del almacenamiento.

## Contexto

Las variantes públicas de fotos y videos se escriben con claves estables (`public/<id>.jpg`, `public/<id>_thumb_s.jpg`).
El cliente S3 solo enviaba `content-type`. Sin `Cache-Control`, cuánto guarda la CDN cada archivo quedaba a merced de
los valores por defecto del proveedor. Eso afecta:

- el costo: cada lectura que la CDN no guarda es egreso del almacenamiento;
- la moderación: cuánto sigue sirviéndose una variante después de borrarla.

El pipeline de mapas ya fija `--cache-control` (`infra/maps/publish.sh`).

## Decisión

1. `StorageProvider.put` acepta `{ cacheControl }`. El cliente S3 lo envía como cabecera firmada y queda guardado con
   el objeto. La CDN lo respeta.
2. `MediaService` escribe todas las variantes públicas con `MEDIA_PUBLIC_CACHE_CONTROL`. El original privado no lleva
   cabecera de caché pública.
3. **Valor por defecto: `public, max-age=3600`.** Una hora absorbe las lecturas repetidas de un evento activo y acota
   a esa hora el tiempo que una media borrada sigue en la CDN. Se puede cambiar por entorno sin tocar código. La
   variable solo acepta valores con forma de Cache-Control, así que no permite inyectar otras cabeceras.
4. El almacenamiento local de desarrollo ignora la opción.

## Consecuencias

- El tiempo que tarda en desaparecer de la CDN una media borrada es conocido y configurable. Para retirarla antes
  sigue haciendo falta invalidar la CDN a mano.
- Las variantes ya escritas conservan sus cabeceras hasta que se regeneren. Hoy no hay media en producción.

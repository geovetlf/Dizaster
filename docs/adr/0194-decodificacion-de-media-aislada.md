# ADR 0194 — Decodificación de media aislada del worker

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

§13.1: los archivos subidos son la mayor superficie de ataque (decodificadores de imagen en código nativo). El
saneado JPEG/MP4, la lectura del video y la re-codificación con sharp/libvips corrían dentro del proceso del worker:
un fallo nativo lo tumbaba entero (y con él los avisos) y un archivo que colgara el decodificador lo bloqueaba.

## Decisión

- `MediaDecoder` (interfaz) con dos implementaciones: `IsolatedDecoder` (por defecto) e `inProcessDecoder` (solo
  desarrollo, `MEDIA_DECODER=inprocess`).
- `IsolatedDecoder`: un proceso hijo (`decoder-child`) que solo recibe bytes y devuelve bytes por IPC. Sin base de
  datos, sin red y **sin el entorno del padre** (ni claves ni secretos). libvips sin caché y con un hilo.
  - Tiempo máximo por archivo (`MEDIA_DECODE_TIMEOUT_MS`, 30 s): al vencer se mata el hijo y el archivo se rechaza.
  - Heap de JS acotado (`MEDIA_DECODER_MAX_OLD_SPACE_MB`, 256); la memoria nativa ya la acota el límite de 50 MP.
  - Si el hijo muere a mitad (fallo nativo), ese archivo se rechaza y el siguiente arranca un hijo nuevo.
  - Se recicla cada 200 archivos. Un archivo a la vez.
- El worker sigue igual por fuera: mismos estados, mismos motivos de rechazo.

## Consecuencias

- Un archivo malicioso ya no puede tumbar ni colgar el worker; como mucho se rechaza ese archivo.
- Recomendado en despliegue: límite de memoria del contenedor del worker (defensa adicional).
- Prueba: `services/core/test/media-decoder.test.ts` (mismos resultados que en proceso, archivo ilegible, tiempo).

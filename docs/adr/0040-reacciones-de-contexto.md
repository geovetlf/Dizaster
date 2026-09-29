# ADR 0040 — Reacciones de contexto

- Estado: Aceptado · Fecha: 2026-09-29 · Blueprint §7.3 (entidad Reaction), RF-02, ADR 0017

## Contexto
Solo existía "me gusta", que suena fuera de lugar en un incendio o un sismo. El Blueprint pide tipos de
reacción apropiados al contexto (apoyo, útil, visto también).

## Decisión
- Tipos: `LIKE`, `SUPPORT` (apoyo), `USEFUL` (útil) y `SEEN_TOO` (yo también lo vi). Una persona puede marcar
  varios en el mismo post; cada uno es idempotente.
- `PUT|DELETE /v1/posts/:id/reactions/:kind` devuelve `{reactions, myReactions}`. El feed trae los totales por
  tipo y los de quien mira. `/like` se mantiene como atajo de `LIKE`.
- `SEEN_TOO` solo se admite en posts ligados a un evento (422 si no).
- **Las reacciones nunca son evidencia.** No publican eventos de dominio, no cambian contadores ni verificación
  del EVENT (lo comprueba una prueba). Así nadie infla la verificación con toques. Al marcar "yo también lo vi",
  la app explica que no cuenta y ofrece enviar un reporte ya ligado al evento.
- App: fila de chips bajo el post (apoyo, útil y, si hay evento, "yo también lo vi") con cambio optimista; el
  corazón sigue en la barra de acciones.

## Consecuencias
- El ranking sigue sumando todas las reacciones como interacción (ADR 0017), sin distinguir tipos.
- Los totales se calculan al leer; se desnormalizarán con un job si el volumen lo pide (Blueprint §7.5).

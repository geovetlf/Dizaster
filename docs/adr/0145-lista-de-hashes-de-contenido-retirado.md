# ADR 0145 — Lista propia de hashes de contenido retirado

- Estado: aceptada (2026-09-29, decisión del propietario: opción A, "queda oculta y pasa a la cola; NO la rechaces")
- AI_REQUIRED: no · EXTERNAL_API_REQUIRED: no · COST: ninguno (índice GIN existente del hash perceptual)
- PRIVACY_IMPACT: bajo: se guardan solo hashes (SHA-256 y perceptual de 64 bits), nunca la imagen.

## Decisión

- `media.blocked_hashes`: al RETIRAR (REMOVE) un post, su media entra en la lista; también la foto de perfil o
  logo quitado (REMOVE_AVATAR), antes de purgarlo. RESTORE (p. ej. apelación aceptada) la saca.
- Al procesar una subida (§5.12, primera línea determinista): coincidencia exacta de SHA-256 o hash perceptual a
  ≤ `NEAR_DUPLICATE_BITS` → la media queda `HELD` (no se muestra en ninguna vista pública), guarda `blocked_match_of`
  y se publica `BlockedMediaMatched`. La subida NO se rechaza: su estado sigue READY para quien la subió.
- Cada post que la usa (al procesarse o al adjuntarse después) abre un caso en la cola. "Aprobar media" la muestra.
- Ocultar (HIDE) no alimenta la lista: solo el retiro definitivo.
- Independiente de la detección de CSAM, que sigue bloqueada (proveedor y procedimiento legal).

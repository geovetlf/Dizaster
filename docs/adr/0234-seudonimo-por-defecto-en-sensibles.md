# ADR 0234 — Reportes sensibles seudónimos por defecto

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

§13.2 dice "reportes sensibles pseudónimos" como visibilidad por defecto y D-05 fija "pseudónimo opcional,
obligatorio en HIGHLY_SENSITIVE". La app empezaba siempre con el interruptor apagado, así que un robo o vandalismo
(SENSITIVE sin `forcePseudonymous`) se publicaba con el nombre de la persona salvo que lo cambiara.

## Decisión

- Al elegir la categoría, el interruptor de seudónimo empieza encendido si la categoría es SENSITIVE o
  HIGHLY_SENSITIVE (según la sensibilidad del país donde está la persona). Se puede apagar en SENSITIVE; en las que
  tienen `forcePseudonymous` sigue siendo obligatorio.
- Al retomar un borrador se respeta lo que la persona eligió.
- No cambia la decisión del propietario de posts y perfiles públicos (ADR 0184): el seudónimo es de reportes y ya
  estaba en el Blueprint.

## Consecuencias

- Menos exposición de quien reporta un delito. Prueba en `pseudonymous-default.test.ts`.

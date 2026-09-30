# ADR 0209 — El historial de ediciones se borra con el post y se exporta; la exportación incluye el consentimiento

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

§13.2 (derecho de supresión y de acceso) y ADR 0136 (edición de posts, historial visible solo para moderación).
Al borrar un post, o la cuenta entera, se vaciaba el texto del post, pero `social.post_edits.previous_text` seguía
guardando las versiones anteriores. Además, la exportación de datos (ADR 0038) no incluía ese historial ni las
aceptaciones de términos (ADR 0176).

## Decisión

- `deletePost` borra las filas de `post_edits` del post.
- `anonymizeProfile` (borrado de cuenta) borra las ediciones hechas por el perfil y las de sus posts.
  `deleteBusinessesOf` borra las de los posts de sus negocios.
- La exportación añade:
  - `social.postEdits`: post, texto anterior y fecha de mis ediciones;
  - `identity.policyAcceptances`: documento, versión, plataforma, versión de la app y fecha.
- Moderación conserva su propia copia del contenido denunciado en el caso (registros aparte, ADR 0143). Esta
  decisión no la toca.

## Consecuencias

- Lo que la persona borra desaparece también en sus versiones anteriores.
- La exportación cubre todas las tablas con datos propios.
- Pruebas en `post-edit.test.ts` y `data-export.test.ts`.

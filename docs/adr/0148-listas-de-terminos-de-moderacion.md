# ADR 0148 — Listas de términos por idioma que envían a revisión

- Estado: aceptada (2026-09-29, decisión del propietario, opción A: mecanismo construido, listas VACÍAS)
- AI_REQUIRED: no · EXTERNAL_API_REQUIRED: no · COST: ninguno

## Decisión

- `data/moderation/terms.json`: listas por idioma (es, en, pt, fr y cualquier código de 2 letras) de
  `{ term, reason }`, donde `reason` es un motivo de denuncia. Se entregan vacías; ningún término concreto se
  introduce en el código ni en los datos hasta que el propietario o el equipo de moderación los configure.
- Coincidencia determinista (`matchTerms` en contracts): palabra o frase completa, sin distinguir mayúsculas ni
  tildes, contra las listas de todos los idiomas (el idioma de un texto corto no es fiable).
- Al crear o editar un post o comentario, una coincidencia publica `ModerationTermsMatched` y moderación abre o suma
  a un caso con el motivo más grave y los términos en la nota. El contenido NUNCA se oculta ni se rechaza por esto.
- Configurar: editar el archivo (se revisa como código) y desplegar; el servidor valida el formato al arrancar.

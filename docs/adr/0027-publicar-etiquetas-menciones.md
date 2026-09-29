# ADR 0027 — Publicar sin reporte, etiquetas y menciones

- Estado: Aceptado · Fecha: 2026-09-29 · Blueprint RF-02, C-01/D-03, §5.4, §7 (Tag, PostEventLink)

## Decisión
- **Publicar sin reporte** (`POST /v1/posts`): texto (1–2000), hasta 4 fotos o videos (máx. 1 video), autoría
  pública o seudónima, y opcionalmente la **mención de un EVENT** (`PostEventLink = MENTION`). Nunca crea ni
  alimenta pines ni verificación y no lleva ubicación (D-03). Un EVENT fusionado se menciona por el que lo
  absorbió; uno oculto no se puede mencionar. Cupo: 20 publicaciones por hora y persona.
- **Etiquetas** (`#tag`): forma canónica en minúsculas y sin tildes (`#Inundación` = `#inundacion`), 2–50
  letras, números o `_`, no solo números, máximo 10 por post. Se guarda la forma escrita la primera vez para
  mostrarla. `GET /v1/tags?q=` (prefijo), `GET /v1/tags/:tag`, `GET /v1/tags/:tag/posts` (por recientes) y
  seguir etiquetas (`/v1/follows/tag/:tag`), que suman sus posts al feed "Siguiendo". Se puede seguir una
  etiqueta antes de que tenga posts.
- **Menciones** (`@handle`): solo se enlazan perfiles existentes que no hayan bloqueado al autor, máximo 10. El
  post expone `mentions` (los handles válidos) y la app solo pinta esos como enlace. Sin notificación push en
  V1: el Alert Engine solo avisa de EVENTs (§5.10); un aviso de mención sería una decisión de producto aparte.
- Las reglas de extracción viven en `@dizaster/contracts` (`extractTags`, `extractMentions`, `segmentText`):
  lo que la app resalta es exactamente lo que el servidor indexa. El texto de los reportes también se indexa.
- **Borrar un post propio** (`DELETE /v1/posts/:id`): se vacía el texto, se quitan etiquetas, menciones y
  reacciones y la media se elimina del almacenamiento. Un post de REPORT no se borra desde aquí (es evidencia
  de un EVENT; se retira por moderación o al borrar la cuenta). Una cuenta suspendida puede borrar sus posts.
- `FeedPost.mine` permite a la app ofrecer "Borrar"; solo es verdadero para quien lo escribió, así un post
  seudónimo no revela a nadie más su autoría.

## Consecuencias
- Tablas `social.tags`, `social.post_tags`, `social.post_mentions` (migración 0016).
- App (iOS y Android): pantalla de redacción, `#` y `@` tocables, pantalla de etiqueta con seguir, etiquetas
  en la búsqueda, "Publicar sobre esto" en el evento y "Solo publicar" al elegir categoría.

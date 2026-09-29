# Referencia visual de la app

El propietario compartió `referencia-inicio.jpg` (2026-09-29) como guía visual. La app la sigue en Android e iOS
con el mismo código.

## Qué se implementó

| Elemento de la referencia | Implementación |
|---|---|
| Tema oscuro, acento rojo, logo DIZ**A**STER y lema | `src/theme.ts`, `components/home/header.tsx` |
| Buscador "Buscar lugar, evento o usuario…" | Abre `search.tsx`: lugares (índice geográfico propio) y categorías; usuarios pendientes |
| Rejilla de categorías (Todos, Desastres, Salud, Delincuencia, Accidentes, Incendios, Infraestructura, Prevención, Ayuda, Más) | `components/home/category-grid.tsx`; sale del catálogo `data/categories` (no está fija en código) |
| Mapa "Eventos cerca de ti" y "Ver mapa completo" | `components/home/map-preview.tsx`, pestaña Mapa |
| Publicaciones recientes: Para ti / Cerca de ti / Siguiendo | `GET /v1/feed`, `components/feed-list.tsx` |
| Tarjeta: autor, tiempo, distintivo de categoría, texto, mosaico de fotos/videos con duración y "+N" | `components/post-card.tsx` |
| Me gusta, comentarios, compartir | `PUT/DELETE /v1/posts/:id/like`, `post/[id].tsx`, enlace `dizaster://` o dominio aprobado |
| Barra inferior: Inicio, Mapa, Reportar (botón central rojo), Videos, Perfil | `app/(tabs)/_layout.tsx` |

## Diferencias deliberadas (y por qué)

1. **Mapa base oscuro vectorial en lugar de satélite.** Las imágenes satelitales tienen licencias con costo por uso;
   la decisión aprobada es MapLibre con datos abiertos (cost-first). El proveedor es intercambiable si más adelante
   se aprueba un mapa satelital.
2. **"Miraflores, Lima" es el lugar del EVENT, no del autor** (ADR 0016). Sale del índice geográfico abierto a
   partir de la ubicación pública ya generalizada. En categorías muy sensibles se muestra solo la ciudad. Si un
   post no tiene evento, se muestra la distancia aproximada ("a menos de 2 km").
3. **Botón SOS en la cabecera.** No está en la referencia, pero en una app de emergencias los números de emergencia
   deben estar a un toque desde la primera pantalla.
4. **Campana sin contador.** Aún no hay bandeja de notificaciones; la campana lleva a activar alertas en este teléfono.
5. **Avatares con iniciales** hasta que existan fotos de perfil. Los reportes seudónimos muestran un escudo y
   "Reporte ciudadano", nunca el nombre.
6. **"Siguiendo" vacío** hasta que exista seguir perfiles; la búsqueda de usuarios llega con los perfiles públicos.
7. **Videos sin reproducción automática en el feed** (ahorra datos móviles); se reproducen al abrir el evento.

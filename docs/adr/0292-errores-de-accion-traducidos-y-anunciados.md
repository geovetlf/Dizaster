# ADR 0292 — Errores de acción traducidos y anunciados

- Estado: Aceptado
- Fecha: 2026-10-01
- Relación con el Blueprint: §3 principio 6 (offline-tolerante), accesibilidad (ADR 0198); ADR 0105, 0190, 0212, 0281
- IA: no. Costo: 0.

## Contexto

Los errores del servidor ya se traducían por código (ADR 0105, 0281) y las cargas de pantalla tenían su estado propio
(ADR 0212). Pero cuando una acción no obtenía respuesta (sin red o sin respuesta a tiempo), la app mostraba el texto
técnico del sistema, en inglés ("Network request failed"), o el aviso fijo en español del tiempo límite. Además, los
errores en línea de unas 25 pantallas eran un `<Text>` que el lector de pantalla no anunciaba, y la pantalla de carga
decía "Revisa tu conexión" también cuando el servidor sí había respondido con un error.

## Decisión

1. `api.request` convierte una petición sin respuesta en un error con texto traducido: `errOffline` (sin conexión) o
   `errTimeout` (sin respuesta a tiempo, marcado con `timedOut` en `fetchWithTimeout`). Sigue sin `status`, así la cola
   de reportes y `classifyLoadError` lo siguen tratando como "sin conexión". Una petición cancelada por quien llama se
   propaga tal cual. Todas las pantallas que muestran `e.message` reciben así el texto traducido sin cambiarlas una a
   una.
2. Los errores en línea se muestran con `<ErrorText>`: marcado como alerta, región viva y anuncio con
   `useAnnounce` cada vez que aparece o cambia. Una prueba impide volver a mostrar un error con un `<Text>` mudo.
3. `LoadState` distingue: sin respuesta → "Revisa tu conexión"; con respuesta de error → "Vuelve a intentarlo en un
   momento".
4. Textos nuevos en es, en, pt y fr.

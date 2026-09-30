# ADR 0212 — Enlaces rotos y contenido borrado: pantallas propias con reintento

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

Los enlaces compartidos (deep links, D-12) pueden apuntar a un evento o post borrado o a una ruta que no existe. En
esos casos la app mostraba:

- una ruta desconocida: la pantalla "Unmatched Route" de Expo Router, sin traducir;
- un evento que falla: el mensaje técnico del error, sin reintento, y una pantalla vacía mientras cargaba;
- un post borrado: la cabecera desaparecía sin explicación.

## Decisión

- `lib/errors/load-error.ts` (`classifyLoadError`) distingue tres casos:
  - `notFound` (404/410): no se reintenta;
  - `offline`: sin respuesta del servidor;
  - `failed`: otro error del servidor.
- `components/load-state.tsx` muestra:
  - un indicador de carga;
  - "Esto ya no está disponible" con "Ir al inicio";
  - "No se pudo cargar" con "Reintentar".
  Los mensajes se anuncian al lector de pantalla y están en es, en, pt y fr.
- `app/+not-found.tsx` sustituye la pantalla por defecto de Expo Router.
- Evento y post usan esos estados. El evento sigue mostrando antes la copia guardada sin red (ADR 0066).

## Consecuencias

- Un enlace viejo o roto lleva a una explicación clara y a una salida, en Android y en iOS.
- Prueba `apps/mobile/test/load-error.test.ts`.

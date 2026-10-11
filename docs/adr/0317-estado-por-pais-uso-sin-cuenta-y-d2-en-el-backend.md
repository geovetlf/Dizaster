# ADR 0317 — Estado de lanzamiento por país, uso sin cuenta y D2 en el backend

- Estado: Aceptado
- Fecha: 2026-10-11
- Relación con el Blueprint: §2, §8.2 (envío de reportes), §11.5 (países); decisiones aprobadas en ADR 0315; ADR 0156, 0171
- IA: **NO AI REQUIRED**. Costo: 0. Sin migraciones.

## Contexto

ADR 0315 registra tres decisiones del propietario que tocan el backend sin cambiar el esquema:

- **Estado de lanzamiento por país:** solo `PILOT` y `AVAILABLE` aceptan reportes ciudadanos. El control va en el
  backend y la configuración es global, sin lógica de Perú en el núcleo.
- **Uso sin cuenta:** sin sesión solo se lee contenido público. Las mismas reglas en la API, el backend y la app.
- **D2:** «No, es otro evento» registra la discrepancia y no cambia el evento, su estado ni su agrupación.

## Decisión

**Estado de lanzamiento por país.**
- `ReferenceModule.acceptsCitizenReports(iso2)` lee `launchStatus` de `data/countries/country-config.json`. Un país
  sin entrada usa el valor de `defaults` (`AVAILABLE_READ_ONLY`). Un punto fuera de todo país (`null`) también usa el
  valor por defecto, así que no acepta reportes. El país sale de `GeoModule.countryOf`, que ya admite hasta 25 km
  fuera del polígono (playas, puertos y la simplificación de Natural Earth), así que un reporte en la costa de un país
  piloto se acepta.
- Un estado desconocido en los datos detiene el arranque con un error claro, en lugar de tratarse como abierto.
- `report.submit` rechaza antes de crear nada: `REJECTED` con código `COUNTRY_READ_ONLY` (HTTP 422). La cola del
  teléfono trata el 422 como definitivo y no reintenta. La app muestra el motivo traducido (es, en, pt, fr).
- Leer el mapa, los eventos y las alertas sigue abierto en cualquier país.
- Abrir un país es un cambio de datos (`launchStatus`), no de código.

**Uso sin cuenta.** El backend ya exigía sesión en toda escritura. `test/guest-read-only.test.ts` lo fija recorriendo
todas las rutas de `/v1/openapi.json`:
- Toda ruta que no sea GET responde 401 sin sesión. Las únicas excepciones son las de entrar y salir
  (`/v1/auth/*`), el informe de cierres inesperados de la app y la entrada de fuentes con su propia firma.
- Todo GET marcado con seguridad responde 401 sin sesión, salvo el enlace firmado de originales de moderación.
- Las lecturas públicas (eventos, categorías, números de emergencia, feed) responden 200.
- Una ruta nueva que escriba sin sesión hace fallar la prueba hasta que se añada a la lista a propósito.
- En la app, un 401 abre «Entrar» (ADR 0171); los números de emergencia siguen sin cuenta.

**D2.** `test/same-event-question.test.ts` compara la huella completa del evento antes y después de responder «No»:
la fila del evento, el número de eventos, la evidencia, la línea de tiempo, el registro de estados, fusiones,
divisiones y la cola de duplicados. Todo debe quedar igual; solo cambia `reporter_answer` en la revisión, que sigue
abierta. No se añade ninguna acción automática.

## Consecuencias

- Diez pruebas reportaban en puntos de mar a más de 25 km de la costa (o en Ecuador) solo para separarse de otras
  pruebas. Ahora usan puntos de tierra en Perú con la misma separación entre sí; lo que prueban no cambia.

- Un reporte hecho desde un país en solo lectura no se guarda. La persona ve el motivo y puede seguir consultando.
- Si un reporte en la cola sin conexión se envía cuando el teléfono ya está en otro país, se rechaza igual: lo que
  cuenta es el punto del reporte.
- Las publicaciones (posts) no dependen del estado del país: la decisión habla de reportes ciudadanos.

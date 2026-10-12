# ADR 0333 — Rechazos y errores definitivos en la cola de reportes de la app

- Estado: Aceptado
- Fecha: 2026-10-11
- Relación con el Blueprint: §8.2 (envío de reportes), §8.3 (sin conexión); ADR 0158, 0281, 0285, 0292, 0317
- IA: **NO AI REQUIRED**. Costo: 0. Sin migraciones. Solo `apps/mobile`.

## Contexto

El servidor responde a un reporte rechazado con HTTP 422 y `{ outcome: "REJECTED", code, reason }`. Los códigos son
`COUNTRY_READ_ONLY`, `INVALID_CATEGORY` y `OFFICIAL_ONLY`. La app tenía ya las traducciones de cada código, pero
nunca llegaban a mostrarse:

- El cliente HTTP trata todo 4xx como error y arma el mensaje con `error` y `message`. Este cuerpo no los tiene, así
  que la persona veía «Revisa los datos e inténtalo de nuevo» en lugar de «Dizaster todavía no acepta reportes en
  este país».
- Ese texto se guardaba en la cola, en el idioma del momento.
- Tras guardar el reporte, la pantalla decía «Sin conexión: tu reporte se guardó y se enviará automáticamente» cuando
  el reporte quedaba detenido por un error definitivo. Pasaba con un rechazo, una cuenta suspendida o una versión
  vieja. No era cierto: un reporte detenido no sale hasta que la persona lo reintente.
- Si el código no se conocía, la app mostraba el motivo del servidor, en español, en cualquier idioma.

## Decisión

- El envío de la cola reconoce el 422 `REJECTED` y lo trata como definitivo. Guarda el código `REJECTED:<código>`,
  nunca un texto. Se traduce al mostrarlo, como los errores de subida (ADR 0285).
- El reporte rechazado no se borra: queda detenido, con su media, en «Mis reportes», donde se puede reintentar o
  descartar (ADR 0158).
  - Reintentar tiene sentido: el servidor no guardó nada y vuelve a decidir. Por ejemplo, si el país se abrió.
- Tras enviar, la pantalla distingue tres casos:
  - **enviado:** el resultado de siempre;
  - **detenido:** el motivo traducido y «No se envió. Quedó guardado en Mis reportes para reintentarlo o
    descartarlo»;
  - **en cola:** «Sin conexión…» solo si de verdad no hubo red. Con un error del servidor que se reintenta, ese
    error y «se reintenta solo».
- Un código de rechazo desconocido muestra solo «Reporte rechazado» fuera del español. El motivo en español del
  servidor solo se muestra en español (ADR 0281).

## Pruebas

En la app, `test/report-rejection.test.ts`:
- el 422 se convierte en código y se explica en los cuatro idiomas;
- un código desconocido no muestra español;
- un rechazo queda detenido y se informa como detenido, no como «sin conexión»;
- sin red y con error del servidor;
- enviado.

## Consecuencias

- La cola sigue sin borrar nada por su cuenta. Un reporte rechazado ocupa su lugar en «Mis reportes» hasta que la
  persona decida.
- Los reportes detenidos antes de este cambio guardan el texto viejo («Revisa los datos e inténtalo de nuevo»).
  Reintentarlos genera el motivo correcto.

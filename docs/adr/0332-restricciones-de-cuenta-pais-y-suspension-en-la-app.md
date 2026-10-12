# ADR 0332 — Restricciones de cuenta, país y suspensión en la app

- Estado: Aceptado
- Fecha: 2026-10-11
- Relación con el Blueprint: §5.1 (cuentas), §8.2 (envío de reportes), §11 (accesibilidad), §11.5 (países), §13
  (moderación); ADR 0171, 0198, 0233, 0240, 0281, 0300, 0317, 0319, 0320
- IA: **NO AI REQUIRED**. Costo: 0. Sin migraciones. Solo `apps/mobile`.

## Contexto

ADR 0317 y 0319 pusieron las reglas en el backend: sin sesión solo se lee, solo los países `PILOT` y `AVAILABLE`
aceptan reportes y las suspensiones tienen fecha de fin. La revisión de los flujos de la app encontró que la interfaz
no las reflejaba:

- **Sin cuenta.** «Entrar» se abría una vez al arrancar. Si la persona lo cerraba:
  - podía abrir Reportar, Publicar, Denunciar, Alertas y sus ajustes, y comentar;
  - al enviar, el 401 decía «Tu sesión expiró; vuelve a entrar» a alguien que nunca tuvo cuenta;
  - el reporte quedaba en la cola con «Sin conexión: se enviará solo», que no era cierto;
  - Perfil mostraba las opciones de una cuenta (exportar, cerrar sesión, borrar cuenta) y ninguna forma de entrar.

  ADR 0317 decía «En la app, un 401 abre Entrar», pero solo pasaba al arrancar.
- **País.** La app dejaba elegir categoría, esperar el GPS, escribir y adjuntar fotos en un país de solo lectura. El
  rechazo llegaba al final, y además mal explicado (ADR 0333).
- **Suspensión.** El 403 `ACCOUNT_SUSPENDED` no decía hasta cuándo.
- **Accesibilidad.** Los interruptores de Reportar («Publicar sin mostrar mi nombre»), Publicar y los ajustes de
  alertas no tenían nombre accesible. El lector de pantalla leía «interruptor, desactivado» sin decir cuál.
- Un cambio de ajustes de alertas que fallaba se deshacía sin decir por qué.

## Decisión

**Sin cuenta: solo lectura, con «Entrar» a mano.**
- Hay invitado cuando la sesión ya arrancó y no hay con qué entrar (`needsSignIn`). El acceso de desarrollo nunca es
  invitado.
- Reportar, Publicar, Denunciar, Alertas y sus ajustes muestran «Necesitas una cuenta» en lugar del formulario. El
  aviso explica qué se puede hacer sin cuenta y tiene «Entrar» y Emergencias.
- En una publicación, la caja de comentario se cambia por «Entra para comentar». «Responder» también lleva a «Entrar».
- Perfil muestra solo lo que funciona sin cuenta: «Entrar», Emergencias, Idioma y Acerca de.
- Cualquier otra escritura (seguir, reaccionar, bloquear…) que el servidor rechace con 401 sin sesión abre «Entrar».
  - Las lecturas no lo abren: una pantalla que consulta algo de la cuenta no debe abrirlo sola.
  - Las rutas de `/v1/auth/` tampoco.
  - Se abre una sola vez aunque fallen varias escrituras a la vez.
- No se pide la edad a quien no tiene cuenta. Se pide después de entrar.
- El servidor sigue siendo la barrera: todo esto solo evita ofrecer lo que va a rechazar.

**País en solo lectura.**
- `data/countries/country-config.json` se copia al bundle, como los demás datos de referencia. Es el mismo archivo que
  usa el servidor.
- Con el primer fix, la app calcula el país en el teléfono, con el mismo algoritmo y los mismos polígonos que el
  servidor. La ubicación no sale del teléfono para esto.
- Fuera de `PILOT` y `AVAILABLE`, la app no deja seguir:
  - dice «Aquí todavía no se puede reportar» y el motivo traducido;
  - deja Emergencias a un toque;
  - el borrador no se toca.
- Un país sin entrada, un punto fuera de todo país o un valor desconocido usan el valor por defecto, como el
  servidor. Un valor desconocido nunca abre un país.

**Suspensión.**
- Si el cuerpo del 403 trae `suspendedUntil` (o `suspended_until`), la app dice «Tu cuenta está suspendida hasta el
  …» en los cuatro idiomas, con la fecha en el formato regional.
- Sin fecha (permanente, o un servidor que aún no la manda), el texto de siempre: la duración y el fin se ven en
  «Mis avisos» (ADR 0319).

**Accesibilidad y errores.**
- Todo `<Switch>` tiene `accessibilityLabel`. Una prueba lo exige en toda la app.
- Un cambio de ajustes de alertas que el servidor rechaza se deshace y se dice por qué (sin red, cuenta
  suspendida…).
- Los avisos de comentarios y respuestas (ADR 0320) tienen su propio icono en el historial; antes usaban el de
  mención.
- «Denunciar» muestra el motivo real del fallo, ya traducido, en lugar de «No se pudo cargar. Revisa tu conexión.».

## Pruebas

En la app, `test/account-restrictions.test.ts`:
- quién es invitado;
- qué 401 abre «Entrar»;
- que «Entrar» se abre una sola vez;
- que los formularios de escritura muestran el aviso;
- el estado por país con los datos reales;
- la suspensión con fecha en los cuatro idiomas.

`test/a11y-labels.test.ts` exige el nombre accesible de cada interruptor.

## Consecuencias

- **Abrir un país necesita una versión nueva de la app para que la app deje reportar allí.** El estado viaja en el
  bundle porque el backend solo lo expone con la ubicación (`/v1/geo/country?lat&lng`), y la app no envía la ubicación
  para esto. Mientras tanto, una app anterior bloquea reportes que el servidor ya aceptaría. Se evita si el backend
  publica el estado por país en `/v1/config` (sin ubicación). Queda propuesto para el backend; no se hizo aquí. Hasta
  entonces, abrir un país va junto con una versión de la app, y la versión mínima (ADR 0164) puede exigirla.
- La fecha de fin de la suspensión en el 403 depende del backend. Hoy el 403 no la manda; la app ya la muestra cuando
  llegue.

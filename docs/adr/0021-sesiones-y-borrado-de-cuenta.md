# ADR 0021 — Sesiones con refresh rotatorio y borrado de cuenta desde la app

- Estado: Aceptado · Fecha: 2026-09-29 · Blueprint §5.1 (Identity), §11 (privacidad), requisitos de App Store 5.1.1(v) y Google Play

## Decisión
- **Acceso corto + refresh rotatorio.** El token de acceso (JWT HS256) dura 15 minutos. Al entrar se abre una
  *familia* de sesión y se entrega un refresh opaco de 32 bytes que dura 60 días y sirve **una sola vez**:
  `POST /v1/auth/refresh` devuelve un par nuevo y marca el anterior como rotado. En la base solo se guarda el
  SHA-256 del refresh (`identity.sessions`).
- **Detección de robo.** Si un refresh ya rotado vuelve a usarse, alguien lo copió: se revoca toda la familia
  (`REUSE_DETECTED`) y tanto la persona como quien lo robó tienen que volver a entrar.
- **Cerrar sesión** (`POST /v1/auth/logout`) revoca la familia del refresh. Una cuenta suspendida puede renovar y
  cerrar sesión (y borrar su cuenta), no publicar.
- **App (iOS y Android igual).** El refresh vive solo en Keychain/Keystore junto a la identidad del dispositivo.
  Cada arranque renueva la sesión existente en vez de volver a entrar. Si una petición recibe 401 se renueva una
  sola vez aunque haya varias peticiones en vuelo (un segundo refresh en paralelo dispararía la detección de
  reuso) y se reintenta; sin red, la sesión no se pierde.
- **Borrar cuenta** (`DELETE /v1/me` con `{"confirm":"DELETE"}`; la app pide escribir BORRAR/DELETE). En una
  transacción: la cuenta queda `DELETED` sin roles, se revocan todas sus sesiones, se borran los tokens push y
  los vínculos con Apple/Google/email (volver a entrar crea una cuenta nueva), y se publica `AccountDeleted`.
  Cada módulo hace lo suyo por el outbox, dentro de su esquema:
  - **social**: perfil anonimizado (`borrado_<id>`, sin nombre) y fuera de búsquedas y enlaces; posts y
    comentarios retirados y vaciados; me gusta, seguimientos y bloqueos borrados.
  - **report**: la evidencia de presencia se generaliza en el acto (sin esperar los 30 días) y se desvincula el
    dispositivo. El reporte sigue contando como evidencia anónima del EVENT: borrarlo cambiaría la verificación
    que otras personas ya vieron.
  - **media**: se borran del almacenamiento el original y todas las variantes públicas; la fila queda `DELETED`
    con el hash (antiabuso de re-subidas).
  - **alert**: preferencias, suscripciones e historial borrados.
  - **moderation**: se conservan acciones, casos y apelaciones (antiabuso y obligación de trazabilidad).
- Un token de acceso ya emitido sigue siendo válido para **leer** hasta 15 minutos; cualquier escritura se rechaza
  al instante (`assertCanWrite`).

## Consecuencias
- Sin coste ni proveedor externo. Sirve igual para el login de desarrollo de hoy y para Apple, Google y email
  cuando se activen (solo cambia cómo se abre la familia).
- Pendiente: pantalla de "dispositivos con sesión abierta" (las familias ya lo permiten), y exportar mis datos
  (portabilidad) si lo exige la legislación de algún país.

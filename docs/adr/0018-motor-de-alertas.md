# ADR 0018 — Motor de alertas push (Notification/Alert Engine)

- Estado: Aceptado · Fecha: 2026-09-29 · Blueprint §8 (alertas), ADR 0004 (privacidad), ADR 0010 (costos), ADR 0017 (seguir)

## Contexto
Las personas quieren enterarse de lo que pasa en los eventos y lugares que siguen y en las categorías que les
importan, sin spam, en Android e iOS por igual, sin coste por mensaje y sin revelar nada de quien reporta.

## Decisión
- **Módulo propio `alert`** (esquema `alert`), independiente del resto: solo reacciona a eventos de dominio del
  outbox (EventCreated, EventEvidenceAdded, VerificationChanged, EventLifecycleChanged) y lee lo demás por las
  interfaces públicas de event, social, identity y geo.
- **Una alerta es un cambio de un EVENT, nunca "hay una publicación nueva"**. Reglas puras y deterministas
  (`rules.ts`):
  - `NEW_EVENT`: el evento pasa a ser alertable (categoría alertable y corroborado por la comunidad, por fuentes
    externas o confirmado oficialmente). Un reporte suelto nunca alerta.
  - `STATE_CHANGED`: confirmación oficial, corroboración externa, disputado o falso.
  - `SEVERITY_UP`: sube hasta severidad ≥ 4.
  - `RESOLVED`: el evento terminó.
- **Destinatarios**: quien sigue el evento; quien sigue su distrito o región (solo los que el EVENT publica: en
  categorías muy sensibles no hay distrito, así que seguirlo no revela más que el mapa); suscripciones por
  categoría + área (distrito, ciudad, región o país entero, con severidad mínima); y, para cambios de estado,
  quien ya recibió una alerta de ese evento. Un evento mar adentro (sismo, tsunami) cuenta para el país cuya costa
  esté a menos de 300 km.
- **Anti-spam**:
  - Deduplicación: cada alerta tiene clave única (`evento:NEW`, `evento:STATE:X`, `evento:SEV:n`, `evento:RESOLVED`)
    y cada persona recibe cada alerta una sola vez (único `(perfil, alerta)`). Si coincide por varios motivos, se
    guarda el más directo.
  - Límite por hora configurable (1–30, por defecto 6): lo que exceda queda solo en el historial.
  - Agrupación: si en un ciclo hay varias alertas para la misma persona, se envía un solo aviso resumen.
  - Horas de silencio con zona horaria de la persona (se sincroniza desde el teléfono). Solo una confirmación
    oficial grave (severidad ≥ 4) atraviesa el silencio y el límite, con prioridad alta y, en iOS,
    `time-sensitive` (nunca "critical alerts", que requieren permiso especial de Apple).
- **Privacidad**: el texto del aviso se arma solo con categoría, lugar contextual ya generalizado, estado y
  severidad. Nunca nombres, handles, texto de posts ni coordenadas; los tests lo comprueban.
- **Preferencias e historial** en el servidor: `/v1/me/alert-preferences`, `/v1/me/alert-subscriptions`,
  `/v1/me/notifications` (+ `/read`). El historial guarda también las alertas que no sonaron y por qué.
- **Proveedor detrás de una interfaz** (`PushSender`): APNs directo por HTTP/2 con clave .p8 (JWT ES256) y FCM
  HTTP v1 con cuenta de servicio. Sin SDK, sin intermediarios y sin coste por mensaje. `PushGateway` reparte por
  proveedor y aísla fallos; los tokens que el proveedor declara muertos se borran. Cambiar a otro proveedor
  (p. ej. un servicio de terceros) es implementar `PushSender`, sin tocar el motor.
- **Envío** en el worker (`AlertService.flush`) con `FOR UPDATE SKIP LOCKED`: varios workers no duplican avisos.
- **Deep link**: el aviso lleva `dizaster://event/<id>` (o `dizaster://alerts` si es un resumen). La app solo acepta
  esas dos formas y navega igual en iOS y Android, también si el toque arrancó la app.

## Alternativas descartadas
- Expo Push Service: gratis pero añade un intermediario que ve el contenido y los tokens, y límites ajenos.
- OneSignal/servicios similares: coste y datos de terceros.
- Alertar por cada post nuevo: spam y riesgo de amplificar rumores sin verificar.

## Consecuencias
- Coste: cero por mensaje; una conexión HTTP/2 a Apple y peticiones HTTPS a Google desde el worker.
- Producción necesita credenciales del propietario (clave APNs .p8 + Team ID + Key ID; cuenta de servicio de
  Firebase). Sin ellas el servidor arranca en modo `log` en desarrollo y se niega a arrancar en producción.
- Pendiente: alertas por cercanía a la ubicación actual (requiere decidir si se guarda una zona aproximada del
  teléfono; hoy V1 no usa ubicación en segundo plano, D-16).

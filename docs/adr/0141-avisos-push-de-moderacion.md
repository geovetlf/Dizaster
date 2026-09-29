# ADR 0141 — Avisos push de moderación y de apelaciones

- Estado: aceptada (2026-09-29; pendiente desde ADR 0020) · AI_REQUIRED: no · COST: push directo APNs/FCM (gratis)
- PRIVACY_IMPACT: bajo: el aviso nunca nombra a quien denunció ni copia el contenido.

## Decisión

- Nuevo tipo de alerta `MODERATION` (match `MODERATION_NOTICE`), sin EVENT ni post; su enlace es `dizaster://my-moderation`.
- Se crea un aviso por cada `ModerationActionTaken` con persona afectada, salvo las acciones que "mis avisos" tampoco
  muestra (DISMISS, RESTORE, UNSUSPEND_USER, APPROVE_MEDIA) y las reversiones.
- Nuevo evento de dominio `AppealDecided`: aviso "se mantuvo" o "se aceptó" tu apelación.
- Pasa por la cola de avisos: horas de silencio, agrupación, historial e idioma. Solo lo apaga el interruptor general de
  avisos (no las preferencias por tipo): es información sobre tu propio contenido y tu derecho a apelar.
- Idempotente por acción o apelación (`dedup_key`). Textos fijos en es/en/pt/fr.
- La app abre "mis avisos" desde el push o el historial; también se enrutan `admin-quality` (antes quedaba sin destino).
- Con `PUSH_DRIVER=log` todo funciona; la entrega real espera las credenciales APNs/FCM ya bloqueadas.

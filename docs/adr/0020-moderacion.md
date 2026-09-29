# ADR 0020 — Moderación: denuncias, cola priorizada, acciones auditables, apelaciones y bloqueos

- Estado: Aceptado · Fecha: 2026-09-29 · Blueprint §5.21, §13.3, Anexo A punto 7 (sin panel web)

## Decisión
- **Módulo `moderation`** (esquema propio). Aplica las acciones a través de social (posts, comentarios), identity
  (suspender) y verification (marcar un EVENT en disputa); nunca toca esquemas ajenos.
- **Denuncias** (`POST /v1/flags`) sobre post, comentario, evento o perfil, con motivo cerrado (privacidad,
  violencia, acoso, ilegal, falso, spam, otro) y nota opcional. Una por persona y objeto; 20 por hora. La respuesta
  es siempre la misma y nadie ve quién denunció.
- **Casos**: uno abierto por objeto. Prioridad determinista = Σ peso del motivo (privacidad y violencia 5 … spam 1)
  × peso de quien denuncia (0,5 si la cuenta tiene menos de 24 h) + log₂(1 + alcance) + gravedad del evento.
- **Regla automática**: 5 personas distintas con cuentas establecidas denuncian un post → pasa a LIMITED (fuera
  de los feeds, accesible por enlace) hasta revisión. Queda registrada como acción de la regla.
- **Acciones** (rol moderator/admin): ocultar, retirar, limitar, restaurar, advertir, suspender, reactivar,
  marcar en disputa, descartar. Motivo obligatorio (≥ 10 caracteres). Registro solo de inserción. Declarar FALSE
  sigue en su ruta propia, que exige evidencia (ADR 0005).
- **Seudónimos**: la moderación ve "autoría seudónima"; puede suspender la cuenta sin que nadie vea quién es.
- **Suspensión**: la cuenta puede entrar, leer, ver el motivo y apelar, pero no publicar ni interactuar
  (comprobado en cada escritura, con caché de 30 s).
- **Transparencia y apelaciones**: la persona afectada ve cada acción y su motivo (`GET /v1/me/moderation`) y puede
  apelar durante 30 días. Decide otra persona (nunca quien actuó); revertir aplica la acción inversa y queda en el
  registro.
- **Bloqueos** (exigidos por App Store y Google Play para contenido de usuarios): ocultan al bloqueador los posts
  con nombre y los comentarios del bloqueado, y cortan el seguimiento mutuo. Los reportes seudónimos no se ocultan:
  pueden ser avisos de seguridad y no revelan a nadie.
- **App**: menú "…" en cada post y pulsación larga en comentarios (máx. 3 opciones, igual en iOS y Android),
  "Denunciar" en eventos y perfiles, bloquear/desbloquear en perfiles, pantalla de avisos con apelación y, para
  moderación, cola, caso y apelaciones dentro de la app.

## Consecuencias
- Sin coste externo. La IA de moderación (segunda línea) queda para cuando haya presupuesto (kill switch `ai`).
- Pendiente: difuminado de rostros y matrículas en media (D-08), avisos push de moderación a la persona afectada,
  y aplicar la regla automática también a comentarios.

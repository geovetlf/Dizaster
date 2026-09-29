# Presupuesto agotado, gasto disparado o abuso de subidas

## Detección
- Tablero de costo en la app (perfil → Costos, rol admin): uso por día, presupuestos, uso de IA (ADR 0110).
- Avisos de umbral: cada umbral de un presupuesto se avisa una vez por periodo (`cost.threshold_alerts`).
- CLI: `pnpm cost:report`.

## Contener
Kill switches remotos (sin desplegar; la app los lee en `/v1/config`):

```http
PUT /v1/admin/kill-switches/media-upload   {"killed": true, "reason": "Pico de subidas"}
PUT /v1/admin/kill-switches/video          {"killed": true, "reason": "Presupuesto de almacenamiento"}
```

Requiere el permiso `ops.control` (admin u operator, con MFA si `STAFF_MFA_REQUIRED`). Con `media-upload` apagado
se puede seguir reportando sin fotos: el reporte nunca depende de la media.

## Límites que ya actúan solos
- Cupo diario de bytes por cuenta según reputación (ADR 0072) y reportes por hora (`REPORTS_PER_HOUR_LIMIT`).
- Funciones de pago: todas empiezan sin presupuesto y apagadas (IA, SMS, traducción); el cost guard las corta al
  agotar el presupuesto sin romper el flujo determinista.

## Volver a la normalidad
1. Entender la causa (abuso de una cuenta → moderación; crecimiento real → decisión de presupuesto del propietario).
2. `{"killed": false}` en el mismo endpoint. Cambiar un presupuesto es una decisión financiera del propietario.

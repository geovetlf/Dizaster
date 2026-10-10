# ADR 0316 — La exportación no falla entera por un campo ilegible

- Estado: Aceptado
- Fecha: 2026-10-10
- Relación con el Blueprint: §13.2 (derechos sobre los datos); ADR 0038, 0048, 0295, 0313
- IA: **NO AI REQUIRED**. Costo: 0.

## Contexto

Al preparar ADR 0313 se vio que un solo valor cifrado ilegible en un reporte hacía fallar `/v1/me/export` entero, con un error
interno. Cada ubicación precisa se cifra con AES-GCM y se ata al id de su reporte (ADR 0048). Hay dos caminos reales
para que no se pueda descifrar:
- una clave de `FIELD_KEYS` retirada antes de volver a cifrar sus filas;
- un dato alterado.

En los dos casos la persona se quedaba sin su exportación, y después debía esperar la pausa entre exportaciones
(ADR 0290).

## Decisión

En la exportación, una ubicación precisa que no se puede descifrar sale como `device_fix: null` y
`precise_location_unreadable: true`. El resto de la exportación sale completo.
- El valor cifrado sigue sin salir nunca.
- No se intenta otra clave ni se devuelve el error. El cifrado sigue detectando el dato alterado: solo deja de tumbar
  la exportación.
- La vista de presencia para moderación no cambia: ahí un valor ilegible sigue siendo un error visible.

`test/field-cipher.test.ts` copia el valor cifrado de un reporte a otro de la misma persona. La exportación responde
200, marca el ilegible y devuelve el otro legible. Sin el cambio, la prueba falla con un 500.

## Consecuencias

- Una clave retirada antes de tiempo deja de impedir el derecho de acceso. La marca permite verla en la exportación.

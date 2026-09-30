# ADR 0271 — El teclado no tapa los campos de texto en iOS ni en Android

- Estado: Aceptado
- Fecha: 2026-09-30
- Relación con el Blueprint: RF-01 (paridad iOS/Android), §6 (app móvil)
- IA: **NO AI REQUIRED**. Costo: 0.

## Contexto

Android redimensiona la ventana cuando aparece el teclado; iOS no. Solo el detalle de un post usaba
`KeyboardAvoidingView`: en iOS, el teclado podía tapar campos en formularios largos (reporte, publicar, editar perfil
o negocio, moderación, inicio de sesión).

## Decisión

- Cada lista o `ScrollView` de una pantalla con `TextInput` lleva `automaticallyAdjustKeyboardInsets` (React Native;
  solo actúa en iOS). Inicio de sesión y editar post pasan de `View` a `ScrollView` para poder desplazarse.
- El detalle de un post mantiene su `KeyboardAvoidingView` y su lista no se ajusta dos veces.
- `softwareKeyboardLayoutMode: "resize"` explícito en `app.config.ts` (es el comportamiento de Expo; queda fijado).
- `test/keyboard.test.ts` falla si una pantalla nueva con campos de texto no se ajusta al teclado.

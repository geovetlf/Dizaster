# ADR 0066: Lectura sin conexión de avisos, mapa y eventos

- Estado: aceptada (Blueprint §5 principio 6 "offline-tolerante", C-04)
- IA: **NO AI REQUIRED**. API externa: ninguna. Costo: 0 (SQLite en el teléfono).

## Decisión

- `lib/offline/read-cache.ts`: `readThrough(store, clave, fetcher)` pide por red; si responde guarda la respuesta y la
  devuelve; si falla devuelve la última copia con su hora (`savedAt`), o el error si no hay copia o tiene más de 7 días.
  Un fallo al guardar nunca rompe la pantalla.
- Tabla `read_cache` en la misma base SQLite local que la cola de reportes (`expo-sqlite`, ya incluido). Poda al
  abrir: máximo 60 entradas y 7 días.
- Qué se guarda: primera página de avisos, la última vista del mapa sin filtros y cada evento abierto (resumen +
  línea de tiempo). Cuando se muestra una copia, la pantalla lo dice: "Sin conexión: copia guardada · hace X".
- Privacidad: las claves no llevan la ubicación del teléfono; al borrar la cuenta la copia se borra con la identidad.
- Los números de emergencia y el país ya funcionaban sin conexión (ADR 0009/0039); la cola de reportes también (ADR 0004).

# ADR 0022 — Alertas por zonas guardadas y por ubicación aproximada al abrir la app

- Estado: Aceptado · Fecha: 2026-09-29 · Blueprint D-16, C-17, §11 (minimización), ADR 0018 (Alert Engine)

## Decisión
- **Zonas guardadas** (`alert.zones`): hasta 5 por persona, de tipo casa, trabajo, familia, estudios u otra, con
  nombre privado opcional y radio de 1 a 50 km (la app ofrece 2, 5, 10 y 25). El punto elegido se reduce al
  centro de su celda H3 r8 (~0,7 km²) antes de guardarlo: la base nunca tiene la dirección exacta de nadie.
  Se eligen con "usar mi ubicación actual" o buscando un lugar del índice geográfico propio.
- **Cerca de mí** (`alert.last_locations`): apagado por defecto. Si la persona lo activa (y da permiso de
  ubicación *mientras se usa la app*), la app envía su última posición conocida redondeada (~1 km) al abrirse,
  como mucho cada 30 minutos. El servidor guarda solo el centro de la celda H3 r7 (~5 km²), una fila por
  persona que se sobrescribe (sin historial) y deja de contar a las 72 h. Apagarlo la borra en el acto; si la
  preferencia está apagada, el servidor no guarda lo que llegue. **Nunca ubicación en segundo plano** (C-17).
- **Coincidencia**: al anunciarse un EVENT (NEW_EVENT), se busca con `ST_DWithin` sobre índices GiST desde su
  ubicación **pública** (ya generalizada según sensibilidad): una zona nunca revela más que el mapa. Radio de
  "cerca de mí": 10 km. Nuevos motivos `SAVED_ZONE` y `NEAR_ME`, con prioridad detrás de "evento seguido" y
  delante de lugares y categorías; aplican la severidad mínima, el límite por hora y las horas de silencio.
  Los cambios de estado posteriores llegan como `PREVIOUSLY_ALERTED`.
- **Preferencias**: `savedZones` (activo por defecto) y `nearMe` (apagado por defecto).
- El texto del aviso no menciona la zona ni su nombre: solo datos públicos del EVENT.
- Borrar la cuenta borra zonas y última ubicación (ADR 0021).
- El texto del permiso de ubicación de iOS y Android se amplía para decir que también se usa, si se activa,
  para mostrar y avisar de lo cercano.

## Consecuencias
- Coste: dos tablas pequeñas y dos consultas indexadas por evento anunciado. Sin proveedor externo.
- Ubicación en segundo plano (geofencing del sistema) queda para después, con revisión de tiendas y batería.

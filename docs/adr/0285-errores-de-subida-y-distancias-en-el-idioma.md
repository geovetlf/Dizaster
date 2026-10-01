# ADR 0285 — Errores de subida y distancias en el idioma y las unidades de la persona

- Estado: Aceptado
- Fecha: 2026-09-30
- Relación con el Blueprint: §5.15 (interfaz multilingüe, unidades métricas o imperiales); ADR 0044, 0216, 0281
- IA: no. Costo: 0.

## Contexto

ADR 0281 promete que ningún texto del sistema llega en español a quien usa otro idioma. Una revisión encontró dos
huecos:

1. **Errores de subida de media.** `lib/media/upload.ts` devolvía textos fijos en español ("El archivo local ya no
   existe", "Subida rechazada (403)", "El servidor rechazó el archivo"). Se guardaban como motivo de un reporte
   detenido en la cola offline y se mostraban tal cual en "Mis reportes", al publicar y al cambiar la foto de perfil.
2. **Distancia de eventos cercanos.** El contrato envía tramos `<100m`, `<500m`, `<2km` y `>2km`. La pantalla de
   reporte ("¿Es el mismo evento?") y la de moderación los mostraban sin traducir y sin respetar las unidades.
   `distanceLabel` solo entendía tramos en km, y los números no usaban el separador decimal de la región. Si el
   evento no tenía título en el idioma, la pantalla de reporte mostraba el código interno de la categoría.

## Decisión

1. El uploader devuelve **códigos** (`LOCAL_FILE_MISSING`, `UPLOAD_REJECTED`, `MEDIA_REJECTED`), no textos. El código
   se guarda en la cola y `uploadErrorText` lo traduce al mostrarlo, así también se aplica un cambio de idioma
   posterior. Los errores de la API ya llegaban traducidos (ADR 0281) y se muestran igual.
2. `distanceLabel` entiende tramos en metros. En imperial muestra pies redondeados a decenas (100 m → 330 ft). Los
   números usan `Intl.NumberFormat` con la región de la persona: "3,1 mi" en fr-FR o pt-BR y "3.1 mi" en es-PE o
   en-US.
3. La pantalla de reporte usa el nombre traducido de la categoría cuando el evento no tiene título en el idioma.

## Pruebas

- `test/upload-errors.test.ts`:
  - el uploader solo devuelve los tres códigos;
  - cada código tiene texto en los cuatro idiomas;
  - la traducción deja igual un texto que ya viene traducido.
- `test/ui-logic.test.ts`: tramos en metros, pies y separador decimal por región.

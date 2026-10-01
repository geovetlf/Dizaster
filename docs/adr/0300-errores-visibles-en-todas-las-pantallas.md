# ADR 0300 — Errores visibles y anunciados en las pantallas que aún los ocultaban

- Estado: Aceptado
- Fecha: 2026-10-01
- Relación con el Blueprint: §11 (accesibilidad), §13.1 (administración); ADR 0291, 0292
- IA: no. Costo: 0.

## Contexto

ADR 0292 creó `ErrorText`, que anuncia el error al lector de pantalla y lo marca como alerta. La prueba que lo exige
solo reconocía la forma exacta `<Text style={styles.error}>{x}</Text>`, y quedaban otras sin cubrir:

- Algunas pantallas reemplazaban el texto de ayuda por el error en el mismo `<Text>`, de modo que el error no se
  anunciaba y la ayuda desaparecía. Pasaba en Bloqueados, Retrasos de publicación y Transparencia.
- Al publicar, un error se mostraba en el mismo texto gris del progreso.
- En Costos, el fallo al cargar y el fallo al guardar un presupuesto usaban el estilo de nota.
- En Negocios, el aviso de ámbito inválido y en Reportar contenido, el fallo al enviar usaban un `<Text>` mudo.

## Decisión

1. Esas pantallas muestran el error con `ErrorText`, aparte de la ayuda, que ya no desaparece.
2. Al publicar, el progreso y el error van separados: el error se anuncia y se borra al reintentar.
3. La prueba de accesibilidad reconoce también:
   - `<Text style={styles.error}>` con cualquier contenido;
   - `<Text style={error ? styles.error : …}>`;
   - un `<Text>` que pinta `{error}`;
   - el patrón `{error ?? …}`.
4. Las cargas que fallan sin que nadie las espere siguen sin aviso, porque son de mejor esfuerzo. Son cosas como
   marcar como leída o compartir. Las colas de moderación ya marcan su pestaña como fallida.

## Consecuencias

- Ningún error de acción o de carga principal queda mudo para el lector de pantalla. La prueba lo vigila de forma
  más amplia.

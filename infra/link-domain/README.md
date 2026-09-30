# Dominio técnico de enlaces (NO es una web de Dizaster)

Dizaster V1 es solo app. Este directorio contiene **únicamente** los dos archivos que Apple y Google exigen
para que un enlace `https://<dominio>/e/<id>` (evento) o `https://<dominio>/p/<id>` (post) abra la app (Universal Links / App Links):

- `.well-known/apple-app-site-association` (iOS)
- `.well-known/assetlinks.json` (Android)

Se sirven como archivos estáticos desde object storage/CDN (costo prácticamente cero). No hay HTML, ni páginas,
ni lógica de producto. Sin este dominio, los enlaces compartidos funcionan igualmente con el esquema `dizaster://`
entre personas que ya tienen la app instalada.

**Pendiente (requiere decisión humana):** elegir y comprar el dominio (D-21), el Team ID de Apple y la huella del
certificado de firma Android. Después: `DIZASTER_LINK_DOMAIN=<dominio>` al compilar la app.

**Vista previa para quien no tiene la app:** solo si resulta estrictamente necesaria se añadiría una respuesta
mínima con etiquetas Open Graph (título, categoría y "descarga la app"). No se construye en esta etapa.

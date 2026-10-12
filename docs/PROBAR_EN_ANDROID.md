# Probar Dizaster en un teléfono Android (local, sin EAS)

Guía para ver la app en un Android físico conectado por USB a tu ordenador. Todo corre en tu ordenador: la base de
datos, la API y Metro. No usa EAS, `EXPO_TOKEN`, cuentas de pago ni servicios en la nube.

## Por qué no sirve Expo Go

Expo Go solo trae los módulos nativos del SDK de Expo. Dizaster usa `@maplibre/maplibre-react-native` (el mapa), que
no está entre ellos (`expo/bundledNativeModules.json` no lo lista) y que al importarse exige su módulo nativo con
`TurboModuleRegistry.getEnforcing`. Como Expo Router carga todas las pantallas al arrancar, la app fallaría en Expo Go
desde el primer momento. Hace falta una build propia: un APK de desarrollo que compilas en tu ordenador.

Este APK es una app aparte (`app.dizaster.mobile`, nombre «Dizaster»). No toca Expo Go ni ninguna otra app instalada.

## 1. Requisitos en tu ordenador (una sola vez)

- Git y **Node 22.12 o superior**.
- **Docker Desktop** (para la base de datos y la API).
- **Android Studio** con, en *SDK Manager*: Android SDK Platform 36, Android SDK Build-Tools 36 y Android SDK
  Platform-Tools. El NDK 27.1 lo descarga Gradle la primera vez si aceptaste las licencias del SDK.
- **JDK 17 o superior**. Sirve el que trae Android Studio (`JAVA_HOME` apuntando a su carpeta `jbr`).
- Variable `ANDROID_HOME` con la ruta del SDK y `platform-tools` en el `PATH` (para tener `adb`).
  - Windows: normalmente `%LOCALAPPDATA%\Android\Sdk`.
  - macOS: `~/Library/Android/sdk`. Linux: `~/Android/Sdk`.

Clona Dizaster en una carpeta propia, separada de cualquier otro proyecto.

## 2. Backend local

```sh
git clone https://github.com/geovetlf/Dizaster.git dizaster
cd dizaster
corepack enable
pnpm install
docker compose up -d --build api      # base de datos, migraciones y API, solo en localhost:8080
curl http://localhost:8080/health      # debe responder {"status":"ok"}
```

`docker-compose.yml` publica la base de datos y la API solo en `127.0.0.1`: nadie más de tu red puede llegar a ellas,
y el teléfono las alcanza por el cable USB con `adb reverse`. No abras puertos en el cortafuegos.

Opcional: `docker compose up -d worker` arranca el worker, que trae eventos reales de las fuentes públicas gratuitas
(por ejemplo, sismos) para que el mapa no esté vacío y procesa las tareas en segundo plano. Hace llamadas a esas
fuentes externas; sin él la app funciona igual, con menos datos.

## 3. Preparar el teléfono

1. *Ajustes → Acerca del teléfono*: toca siete veces *Número de compilación* para activar las opciones de desarrollador.
2. *Ajustes → Sistema → Opciones de desarrollador*: activa *Depuración USB*.
3. Conecta el teléfono por USB. Si pregunta el modo USB, elige *Transferencia de archivos*.
4. Acepta el aviso *¿Permitir la depuración por USB?* y marca *Permitir siempre desde este ordenador*.

```sh
adb devices          # tu teléfono debe aparecer como "device"
```

## 4. Compilar e instalar (la primera vez)

Con el teléfono conectado, desde la carpeta `dizaster`:

```sh
adb reverse tcp:8080 tcp:8080          # el localhost:8080 del teléfono llega a la API de tu ordenador
cd apps/mobile
```

macOS o Linux:

```sh
DIZASTER_API_URL=http://localhost:8080 npx expo run:android --device
```

Windows (PowerShell):

```powershell
$env:DIZASTER_API_URL="http://localhost:8080"; npx expo run:android --device
```

`expo run:android` genera la carpeta `android/` (no se versiona), compila el APK de depuración con Gradle, lo
instala, abre la app y deja Metro en marcha. También redirige el puerto 8081 de Metro por USB. La primera compilación
tarda bastante y descarga varios GB (Gradle, dependencias de Android); las siguientes son mucho más rápidas.

`DIZASTER_API_URL` se graba en el APK al compilar. Si no la pones, la app busca la API en `10.0.2.2`, que solo existe
en el emulador.

## 5. Los días siguientes (sin recompilar)

Solo hay que recompilar si cambian las dependencias nativas o `app.config.ts`. Para el código JavaScript basta Metro:

```sh
adb reverse tcp:8080 tcp:8080
adb reverse tcp:8081 tcp:8081
cd apps/mobile
DIZASTER_API_URL=http://localhost:8080 npx expo start      # en PowerShell, con $env: como arriba
```

Después abre la app **Dizaster** en el teléfono (no Expo Go). Se conecta sola a Metro por el cable.

`adb reverse` se pierde al desconectar el cable o reiniciar `adb`: repite los dos comandos al reconectar.

## 6. Comprobar Fast Refresh

1. Con la app abierta en la pestaña de inicio, edita `apps/mobile/src/lib/i18n.ts` y cambia `home: "Inicio"` por
   otro texto.
2. Guarda. En uno o dos segundos cambia el nombre de la pestaña sin reiniciar la app.
3. Deshaz el cambio.

Menú de desarrollo: agita el teléfono o ejecuta `adb shell input keyevent 82`. Desde ahí puedes recargar.

## 7. Qué funciona en esta prueba local

Es lo esperado según el código y la configuración; todavía no se ha probado en un teléfono.

| Función | Estado esperado |
| --- | --- |
| Navegación, pantallas, idiomas, emergencia sin conexión | Disponible |
| Mapa | Disponible con el estilo de demostración de MapLibre (baja resolución; el teléfono necesita internet) |
| Inicio de sesión | Acceso de desarrollo (`DEV_AUTH_ENABLED`), sin email |
| Reportar | Solo si tu ubicación está en un país en `PILOT` o `AVAILABLE` (Perú está en `PILOT`) |
| Fotos | Se guardan en el disco del contenedor de la API |
| Eventos de fuentes oficiales o externas | Solo con el worker en marcha |
| Notificaciones push | No: requieren Firebase (`google-services.json`), pendiente del propietario |
| Inicio de sesión por email | No: requiere proveedor de email, pendiente del propietario |

La base de datos empieza vacía: el feed y el mapa no muestran nada hasta que reportes o arranque el worker.

## 8. Problemas frecuentes

**`adb devices` muestra `unauthorized`.** Desbloquea el teléfono y acepta el aviso de depuración USB. Si no aparece:
*Opciones de desarrollador → Revocar autorizaciones de depuración USB*, desconecta y vuelve a conectar, y ejecuta
`adb kill-server` y luego `adb devices`.

**`adb devices` no muestra nada.** Prueba otro cable (algunos solo cargan) o el modo *Transferencia de archivos*. En
Windows puede faltar el controlador USB del fabricante.

**La app no conecta con la API** (errores de red en las pantallas):
1. `curl http://localhost:8080/health` en el ordenador debe responder `ok`; si no, `docker compose ps` y
   `docker compose logs api`.
2. Repite `adb reverse tcp:8080 tcp:8080` (se pierde al desconectar). `adb reverse --list` muestra las redirecciones.
3. Si compilaste sin `DIZASTER_API_URL`, la app apunta a `10.0.2.2`: vuelve a ejecutar el paso 4 con la variable.

**Pantalla roja «Unable to load script» o «Could not connect to development server».** Metro no está en marcha o se
perdió la redirección: arranca `npx expo start` y ejecuta `adb reverse tcp:8081 tcp:8081`; luego recarga desde el
menú de desarrollo.

**Falla Gradle con «SDK location not found» o por la versión de Java.** Revisa `ANDROID_HOME` y `JAVA_HOME` (JDK 17 o
superior) y abre una terminal nueva.

**Wi-Fi en lugar de cable.** Es posible, pero exige publicar la API y Metro en tu red local. Esta guía usa el cable a
propósito, para que nada quede expuesto.

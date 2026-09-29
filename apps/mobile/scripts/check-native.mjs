// Genera los proyectos nativos de iOS y Android (Continuous Native Generation) en una carpeta temporal del
// propio proyecto y comprueba que ambos salen con la misma configuración. No requiere Mac ni Xcode:
// valida lo que EAS Build compilará. Los directorios ios/ y android/ se borran al terminar (no se versionan).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";

const clean = () => { rmSync("ios", { recursive: true, force: true }); rmSync("android", { recursive: true, force: true }); };
const failures = [];
const expect = (cond, msg) => { if (!cond) failures.push(msg); };

clean();
try {
  execFileSync("npx", ["expo", "prebuild", "--no-install", "--clean", "--platform", "all"], { stdio: "inherit", env: { ...process.env, CI: "1" } });

  const plist = readFileSync("ios/Dizaster/Info.plist", "utf8");
  const entitlements = readFileSync("ios/Dizaster/Dizaster.entitlements", "utf8");
  const manifest = readFileSync("android/app/src/main/AndroidManifest.xml", "utf8");
  const granted = (p) => new RegExp(`android.permission.${p}"(?! tools:node="remove")`).test(manifest);

  for (const k of ["NSLocationWhenInUseUsageDescription", "NSCameraUsageDescription", "NSMicrophoneUsageDescription", "NSPhotoLibraryUsageDescription"]) {
    expect(plist.includes(`<key>${k}</key>`), `iOS: falta ${k}`);
  }
  for (const k of ["NSLocationAlwaysUsageDescription", "NSFaceIDUsageDescription", "NSMotionUsageDescription"]) {
    expect(!plist.includes(`<key>${k}</key>`), `iOS: sobra ${k}`);
  }
  expect(!plist.includes("Allow $(PRODUCT_NAME)"), "iOS: quedan textos de permiso genéricos (Apple los rechaza)");
  expect(plist.includes("<string>dizaster</string>"), "iOS: falta el esquema dizaster://");
  expect(entitlements.includes("aps-environment"), "iOS: falta el entitlement de push (APNs)");
  expect(existsSync("ios/Dizaster/PrivacyInfo.xcprivacy"), "iOS: falta el manifiesto de privacidad");
  // Diálogos de permisos en los idiomas iniciales (D-19).
  for (const l of ["es", "en", "pt", "fr"]) {
    const f = `ios/Dizaster/Supporting/${l}.lproj/InfoPlist.strings`;
    expect(existsSync(f) && readFileSync(f, "utf8").includes("NSLocationWhenInUseUsageDescription"), `iOS: faltan los textos de permisos en ${l}`);
  }

  for (const p of ["ACCESS_FINE_LOCATION", "CAMERA", "RECORD_AUDIO", "POST_NOTIFICATIONS"]) expect(granted(p), `Android: falta ${p}`);
  for (const p of ["ACCESS_BACKGROUND_LOCATION", "SYSTEM_ALERT_WINDOW", "READ_EXTERNAL_STORAGE", "WRITE_EXTERNAL_STORAGE"]) {
    expect(!granted(p), `Android: ${p} no debe concederse`);
  }
  expect(manifest.includes('android:scheme="dizaster"'), "Android: falta el esquema dizaster://");
} finally {
  clean();
}

if (failures.length) {
  console.error(`Paridad nativa: ${failures.length} problema(s)\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("Paridad nativa iOS/Android: OK");

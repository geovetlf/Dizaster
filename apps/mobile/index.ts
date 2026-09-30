// Entrada de la app. El idioma elegido se aplica antes de cargar cualquier pantalla (ADR 0069); el orden importa.
import "./src/lib/language-boot";
// La tarea de segundo plano se define al cargar el bundle, también cuando el sistema despierta la app (ADR 0190).
import "./src/lib/report/background";
import "expo-router/entry";

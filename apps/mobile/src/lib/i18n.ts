/**
 * Textos de la interfaz. Primer corte con español e inglés; los catálogos completos (ICU MessageFormat)
 * y más idiomas llegan con la capa Global/Locale.
 */
const catalogs = {
  es: {
    report: "Reportar",
    emergency: "Emergencia",
    chooseCategory: "¿Qué está pasando?",
    locating: "Obteniendo tu ubicación…",
    locationDenied: "Sin permiso de ubicación no se puede crear un reporte con pin. Puedes publicar un post normal.",
    send: "Enviar reporte",
    sending: "Enviando…",
    queuedOffline: "Sin conexión: tu reporte se guardó y se enviará automáticamente.",
    pseudonymous: "Publicar sin mostrar mi nombre",
    pseudonymousForced: "En esta categoría tu nombre nunca se muestra.",
    callFirst: "Si hay riesgo para la vida, llama primero a emergencias.",
    privacyNote: "Tu ubicación exacta no se publica. Solo se usa para comprobar que estás en el lugar.",
    created: "Creaste un nuevo evento.",
    attached: "Tu reporte se sumó a un evento existente.",
    downgraded: "No pudimos comprobar que estás en el lugar; se publicó como post sin pin.",
    rejected: "Reporte rechazado",
    emergencyTitle: "Números de emergencia",
    unverifiedNumbers: "Números pendientes de verificación oficial. Confírmalos con las autoridades locales.",
    gsmFallback: "No tenemos números para este país. 112 es el número de emergencia estándar en redes móviles GSM, pero confírmalo localmente.",
    call: "Llamar",
    timeline: "Cronología",
    reports: "reportes",
    sources: "fuentes",
    adjustPin: "Toca el mapa para ajustar el pin (solo cerca de donde estás).",
    sameEvent: "¿Es alguno de estos?",
    newEvent: "No, es otro acontecimiento",
    selected: "Seleccionado",
  },
  en: {
    report: "Report",
    emergency: "Emergency",
    chooseCategory: "What is happening?",
    locating: "Getting your location…",
    locationDenied: "Without location permission a pinned report can't be created. You can still publish a regular post.",
    send: "Send report",
    sending: "Sending…",
    queuedOffline: "Offline: your report was saved and will be sent automatically.",
    pseudonymous: "Publish without showing my name",
    pseudonymousForced: "Your name is never shown in this category.",
    callFirst: "If lives are at risk, call emergency services first.",
    privacyNote: "Your exact location is never published. It is only used to check you are there.",
    created: "You created a new event.",
    attached: "Your report was added to an existing event.",
    downgraded: "We couldn't confirm you are there; it was published as a post without a pin.",
    rejected: "Report rejected",
    emergencyTitle: "Emergency numbers",
    unverifiedNumbers: "Numbers pending official verification. Confirm them with local authorities.",
    gsmFallback: "We have no numbers for this country. 112 is the standard GSM emergency number, but confirm locally.",
    call: "Call",
    timeline: "Timeline",
    reports: "reports",
    sources: "sources",
    adjustPin: "Tap the map to adjust the pin (only near where you are).",
    sameEvent: "Is it one of these?",
    newEvent: "No, it's something else",
    selected: "Selected",
  },
} as const;

export type MessageKey = keyof (typeof catalogs)["es"];
export const locale: string = Intl.DateTimeFormat().resolvedOptions().locale ?? "es";
const lang: keyof typeof catalogs = locale.startsWith("en") ? "en" : "es";
export const t = (key: MessageKey): string => catalogs[lang][key];

export const VERIFICATION_LABEL: Record<string, { es: string; en: string; color: string }> = {
  UNVERIFIED: { es: "Sin verificar", en: "Unverified", color: "#8a94a6" },
  COMMUNITY_CORROBORATED: { es: "Corroborado por la comunidad", en: "Community corroborated", color: "#2f80ed" },
  EXTERNALLY_CORROBORATED: { es: "Corroborado por fuentes externas", en: "Externally corroborated", color: "#9b51e0" },
  OFFICIALLY_CONFIRMED: { es: "Confirmado oficialmente", en: "Officially confirmed", color: "#27ae60" },
  DISPUTED: { es: "En disputa", en: "Disputed", color: "#f2994a" },
  FALSE: { es: "Falso", en: "False", color: "#eb5757" },
};
export const verificationLabel = (state: string) => VERIFICATION_LABEL[state]?.[lang] ?? state;

import { Alert } from "react-native";
import { api } from "../api";
import { t } from "../i18n";

/**
 * "¿Es el mismo evento?" (ADR 0156, §8.4): el reporte se sumó a un evento en la franja ambigua. "No estoy seguro"
 * no envía nada; la pregunta sigue disponible en Mis reportes. Un fallo de red no molesta: se puede responder luego.
 */
export function askSameEvent(reportId: string, onAnswered?: () => void): void {
  const send = (answer: "SAME" | "DIFFERENT") => void api.answerReportMatch(reportId, answer).then(() => onAnswered?.()).catch(() => undefined);
  Alert.alert(t("sameEventTitle"), t("sameEventBody"), [
    { text: t("sameEventUnsure"), style: "cancel" },
    { text: t("sameEventNo"), onPress: () => send("DIFFERENT") },
    { text: t("sameEventYes"), onPress: () => send("SAME") },
  ]);
}

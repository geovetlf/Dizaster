import { Stack } from "expo-router";
import { NotFound } from "../components/load-state";
import { t } from "../lib/i18n";

/** Enlace a una ruta que no existe (ADR 0212): pantalla propia y traducida, no la de Expo Router. */
export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: t("notFoundTitle") }} />
      <NotFound />
    </>
  );
}

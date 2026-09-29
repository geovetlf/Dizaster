import { Redirect } from "expo-router";

/** Ruta técnica del botón central: el reporte se abre como modal (ver (tabs)/_layout.tsx). */
export default function NewReportTab() {
  return <Redirect href="/report" />;
}

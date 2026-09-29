import { useEffect, useState } from "react";
import { api } from "../api";

/** Roles de la cuenta (ADR 0101). Vacío mientras carga o sin sesión: la app no muestra herramientas de más. */
export function useRoles(): string[] {
  const [roles, setRoles] = useState<string[]>([]);
  useEffect(() => { api.account().then((a) => setRoles(a.roles)).catch(() => setRoles([])); }, []);
  return roles;
}

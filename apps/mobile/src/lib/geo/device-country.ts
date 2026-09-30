import * as Cellular from "expo-cellular";
import * as Location from "expo-location";
import { regionOf } from "../emergency";
import { locale } from "../i18n";
import { countryOf } from "./country";
import { chooseCountry, type CountrySource } from "./country-choice";
import { preferredCountry } from "./preferred-country";

/**
 * País sin esperar al GPS (ADR 0183): última posición conocida si hay permiso, luego SIM, perfil y región del sistema.
 * Instantáneo y offline: sirve para mostrar el botón de llamada de emergencia antes de tener un fix.
 */
export async function quickCountry(): Promise<{ country: string | null; source: CountrySource | null }> {
  let located: string | null = null;
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    const pos = perm.granted ? await Location.getLastKnownPositionAsync() : null;
    located = pos ? countryOf({ lat: pos.coords.latitude, lng: pos.coords.longitude }) : null;
  } catch {
    // Sin permiso o sin posición guardada.
  }
  const sim = await Cellular.getIsoCountryCodeAsync().catch(() => null);
  return chooseCountry(located, preferredCountry(), regionOf(locale), sim);
}

/** Como `quickCountry`, pero si no hay posición guardada pide una de baja precisión (pantalla de emergencia). */
export async function detectCountry(): Promise<{ country: string | null; source: CountrySource | null }> {
  let located: string | null = null;
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    const pos = perm.granted
      ? ((await Location.getLastKnownPositionAsync()) ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low })))
      : null;
    // La ubicación no sale del dispositivo.
    located = pos ? countryOf({ lat: pos.coords.latitude, lng: pos.coords.longitude }) : null;
  } catch {
    // Sin permiso o sin señal: país preferido o región del teléfono.
  }
  // País de la SIM: sin permisos y sin red; en iOS devuelve null.
  const sim = await Cellular.getIsoCountryCodeAsync().catch(() => null);
  return chooseCountry(located, preferredCountry(), regionOf(locale), sim);
}

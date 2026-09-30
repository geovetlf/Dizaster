# ADR 0169 — País para emergencias también desde la SIM

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno (lectura local, sin red ni permisos)

## Contexto

§11.5: el país para los números de emergencia sale de la ubicación calculada en el teléfono y, sin ella, del país de
la SIM/red y después del idioma del sistema. La app pasaba de la ubicación al país preferido del perfil (ADR 0085) y
a la región del sistema, sin mirar la SIM.

## Decisión

- `expo-cellular` (módulo de Expo, incluido en Expo Go; sin permisos): `getIsoCountryCodeAsync`.
- Orden en `chooseCountry`: ubicación → SIM → país preferido del perfil → región del sistema. Un código que no son
  dos letras se ignora. En iOS la función devuelve `null` (Apple retiró el dato del operador): sigue el perfil.
- Cuando el país sale de la SIM, la pantalla lo dice e invita a activar la ubicación (la SIM es la del país de
  origen para quien viaja).
- Pendiente de datos, no de código: números por región dentro de un país (`subdivision`); la función ya los acepta.

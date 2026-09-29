import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { hexToBytes, bytesToHex } from "@noble/hashes/utils.js";
import { api } from "../api";
import { signingPublicKey } from "../report/evidence";

/**
 * Semilla Ed25519 con la que el teléfono firma la evidencia de sus reportes (ADR 0129). Solo en el almacén seguro
 * del sistema (Keychain / Keystore), solo en este dispositivo; al servidor va únicamente la clave pública.
 * Pendiente (propietario, build de desarrollo): clave en hardware con atestación (App Attest / Key Attestation).
 */
const KEY = "dizaster.signing.v1";
const OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

export async function signingSeed(): Promise<Uint8Array> {
  const stored = await SecureStore.getItemAsync(KEY, OPTIONS).catch(() => null);
  if (stored && /^[0-9a-f]{64}$/.test(stored)) return hexToBytes(stored);
  const seed = Crypto.getRandomBytes(32);
  await SecureStore.setItemAsync(KEY, bytesToHex(seed), OPTIONS);
  return seed;
}

/** Registra la clave pública del dispositivo. Idempotente: se llama en cada inicio de sesión. */
export async function registerSigningKey(deviceId: string): Promise<void> {
  await api.registerSigningKey(deviceId, signingPublicKey(await signingSeed()));
}

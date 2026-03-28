/**
 * Secure storage adapter for Capacitor using Preferences API.
 * Falls back to localStorage for web preview.
 */

import { Preferences } from "@capacitor/preferences";

const STORAGE_KEYS = {
  SESSION_BUNDLE: "t3:mobile:session",
  DEVICE_NAME: "t3:mobile:deviceName",
  CONNECTION_MODE: "t3:mobile:connectionMode",
  LOCAL_URL: "t3:mobile:localUrl",
  VPN_URL: "t3:mobile:vpnUrl",
} as const;

/**
 * Checks if running in Capacitor native environment.
 */
function isNative(): boolean {
  return typeof (window as any).Capacitor !== "undefined";
}

/**
 * Gets a value from secure storage.
 */
export async function getSecureItem(key: string): Promise<string | null> {
  if (isNative()) {
    const { value } = await Preferences.get({ key });
    return value;
  }
  // Fallback for web
  return localStorage.getItem(key);
}

/**
 * Sets a value in secure storage.
 */
export async function setSecureItem(key: string, value: string): Promise<void> {
  if (isNative()) {
    await Preferences.set({ key, value });
  } else {
    localStorage.setItem(key, value);
  }
}

/**
 * Removes a value from secure storage.
 */
export async function removeSecureItem(key: string): Promise<void> {
  if (isNative()) {
    await Preferences.remove({ key });
  } else {
    localStorage.removeItem(key);
  }
}

export { STORAGE_KEYS };

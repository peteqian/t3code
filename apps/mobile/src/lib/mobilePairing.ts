import { getSecureItem, removeSecureItem, setSecureItem, STORAGE_KEYS } from "./storage";

export type MobileConnectionMode = "auto" | "local" | "vpn";
export type MobileConnectionTarget = "local" | "vpn";

export interface MobileConnectionCandidate {
  readonly target: MobileConnectionTarget;
  readonly serverBaseUrl: string;
}

export interface MobileSessionBundle {
  readonly deviceId: string;
  readonly deviceName: string;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: string;
}

export interface MobileSettings {
  readonly connectionMode: MobileConnectionMode;
  readonly localServerBaseUrl: string;
  readonly vpnServerBaseUrl: string;
  readonly deviceName: string;
}

const DEFAULT_LOCAL_URL = "http://127.0.0.1:3773";
const DEFAULT_VPN_URL = "http://your-host.ts.net:3773";

/**
 * Loads saved mobile session bundle from secure storage.
 */
export async function loadSession(): Promise<MobileSessionBundle | null> {
  const raw = await getSecureItem(STORAGE_KEYS.SESSION_BUNDLE);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as MobileSessionBundle;
  } catch {
    return null;
  }
}

/**
 * Saves mobile session bundle to secure storage.
 */
export async function saveSession(bundle: MobileSessionBundle): Promise<void> {
  await setSecureItem(STORAGE_KEYS.SESSION_BUNDLE, JSON.stringify(bundle));
}

/**
 * Clears saved mobile session from storage.
 */
export async function clearSession(): Promise<void> {
  await removeSecureItem(STORAGE_KEYS.SESSION_BUNDLE);
}

/**
 * Loads mobile app settings from secure storage.
 */
export async function loadSettings(): Promise<MobileSettings> {
  const [mode, localUrl, vpnUrl, deviceName] = await Promise.all([
    getSecureItem(STORAGE_KEYS.CONNECTION_MODE),
    getSecureItem(STORAGE_KEYS.LOCAL_URL),
    getSecureItem(STORAGE_KEYS.VPN_URL),
    getSecureItem(STORAGE_KEYS.DEVICE_NAME),
  ]);

  return {
    connectionMode: (mode as MobileConnectionMode) || "auto",
    localServerBaseUrl: localUrl || DEFAULT_LOCAL_URL,
    vpnServerBaseUrl: vpnUrl || DEFAULT_VPN_URL,
    deviceName: deviceName || "Mobile Device",
  };
}

/**
 * Saves mobile app settings to secure storage.
 */
export async function saveSettings(settings: MobileSettings): Promise<void> {
  await Promise.all([
    setSecureItem(STORAGE_KEYS.CONNECTION_MODE, settings.connectionMode),
    setSecureItem(STORAGE_KEYS.LOCAL_URL, settings.localServerBaseUrl),
    setSecureItem(STORAGE_KEYS.VPN_URL, settings.vpnServerBaseUrl),
    setSecureItem(STORAGE_KEYS.DEVICE_NAME, settings.deviceName),
  ]);
}

/**
 * Resolves connection candidates based on mode and saved URLs.
 */
export function resolveConnectionCandidates(
  mode: MobileConnectionMode,
  localUrl: string,
  vpnUrl: string,
  lastKnownTarget: MobileConnectionTarget | null,
): MobileConnectionCandidate[] {
  const candidates: MobileConnectionCandidate[] = [];

  if (lastKnownTarget === "vpn" && vpnUrl) {
    candidates.push({ target: "vpn", serverBaseUrl: vpnUrl });
  }

  if (mode === "auto" || mode === "vpn") {
    if (vpnUrl) {
      candidates.push({ target: "vpn", serverBaseUrl: vpnUrl });
    }
  }

  if (mode === "auto" || mode === "local") {
    if (localUrl) {
      candidates.push({ target: "local", serverBaseUrl: localUrl });
    }
  }

  return candidates;
}

/**
 * Builds WebSocket URL from base URL and token.
 */
export function buildWebSocketUrl(baseUrl: string, token: string): string {
  const wsProtocol = baseUrl.startsWith("https") ? "wss" : "ws";
  const cleanBase = baseUrl.replace(/^https?:\/\//, "").replace(/^http?:\/\//, "");
  return `${wsProtocol}://${cleanBase}/ws?token=${encodeURIComponent(token)}`;
}

/**
 * Exchanges a pairing code for session credentials.
 */
export async function exchangePairingCode(
  serverBaseUrl: string,
  deviceName: string,
  pairingCode: string,
): Promise<MobileSessionBundle> {
  const url = `${serverBaseUrl}/api/mobile/pairing/exchange`;
  console.log(`[API] POST ${url}`);
  console.log("[API] Body:", { deviceName, pairingCode: pairingCode.slice(0, 4) + "..." });

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceName, pairingCode }),
    });

    console.log("[API] Response status:", response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[API] Error response:", errorText);
      let errorMessage = `HTTP ${response.status}`;
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.message || errorMessage;
      } catch {
        if (errorText) errorMessage += `: ${errorText}`;
      }
      throw new Error(errorMessage);
    }

    const data = await response.json();
    console.log("[API] Success! Got session bundle");
    return data;
  } catch (err) {
    if (err instanceof TypeError && err.message.includes("fetch")) {
      console.error(`[API] Network error - cannot connect to ${serverBaseUrl}`);
      console.error("[API] Make sure:");
      console.error("  1. Server is running");
      console.error("  2. Using correct IP (not localhost/127.0.0.1 in simulator)");
      console.error("  3. Server allows connections from your device IP");
      throw new Error(
        `Cannot connect to ${serverBaseUrl} - check server is running and URL is correct`,
      );
    }
    console.error("[API] Fetch error:", err);
    throw err;
  }
}

/**
 * Refreshes the access token using the refresh token.
 */
export async function refreshSessionToken(
  serverBaseUrl: string,
  refreshToken: string,
): Promise<MobileSessionBundle> {
  const response = await fetch(`${serverBaseUrl}/api/mobile/token/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });

  if (!response.ok) {
    throw new Error("Token refresh failed");
  }

  return response.json();
}

/**
 * Describes connection target in user-friendly terms.
 */
export function describeConnectionTarget(target: MobileConnectionTarget): string {
  if (target === "vpn") return "VPN";
  if (target === "local") return "Local";
  return "Unknown";
}

/**
 * Attempts connection with fallback candidates.
 */
export async function executeWithConnectionCandidates<T>(
  candidates: MobileConnectionCandidate[],
  operation: (candidate: MobileConnectionCandidate) => Promise<T>,
): Promise<{ candidate: MobileConnectionCandidate; result: T }> {
  const errors: string[] = [];

  for (const candidate of candidates) {
    try {
      const result = await operation(candidate);
      return { candidate, result };
    } catch (error) {
      errors.push(`${candidate.target}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`All connection attempts failed: ${errors.join("; ")}`);
}

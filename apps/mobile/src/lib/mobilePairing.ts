import { getSecureItem, removeSecureItem, setSecureItem, STORAGE_KEYS } from "./storage";

export interface MobileSessionBundle {
  readonly deviceId: string;
  readonly deviceName: string;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: string;
}

export interface MobileSettings {
  readonly serverBaseUrl: string;
  readonly deviceName: string;
}

export interface MobileAccessRequestState {
  readonly requestId: string;
  readonly status: "pending" | "approved" | "rejected" | "expired";
  readonly expiresAt: string;
  readonly createdAt?: string;
  readonly session?: MobileSessionBundle;
}

const DEFAULT_SERVER_URL = "http://127.0.0.1:3773";

function toNetworkError(serverBaseUrl: string, err: unknown): Error {
  const error = new Error(
    `Cannot connect to ${serverBaseUrl} - check that the server is running and this address is reachable from iOS`,
  );
  (error as Error & { cause?: unknown }).cause = err;
  return error;
}

function normalizeServerBaseUrl(value: string | null | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return DEFAULT_SERVER_URL;
  }

  return trimmed.replace(/\/+$/, "");
}

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
  const [serverUrl, legacyLocalUrl, legacyVpnUrl, deviceName] = await Promise.all([
    getSecureItem(STORAGE_KEYS.SERVER_URL),
    getSecureItem(STORAGE_KEYS.LEGACY_LOCAL_URL),
    getSecureItem(STORAGE_KEYS.LEGACY_VPN_URL),
    getSecureItem(STORAGE_KEYS.DEVICE_NAME),
  ]);

  return {
    serverBaseUrl: normalizeServerBaseUrl(serverUrl ?? legacyLocalUrl ?? legacyVpnUrl),
    deviceName: deviceName || "Mobile Device",
  };
}

/**
 * Saves mobile app settings to secure storage.
 */
export async function saveSettings(settings: MobileSettings): Promise<void> {
  await Promise.all([
    setSecureItem(STORAGE_KEYS.SERVER_URL, normalizeServerBaseUrl(settings.serverBaseUrl)),
    setSecureItem(STORAGE_KEYS.DEVICE_NAME, settings.deviceName),
    removeSecureItem(STORAGE_KEYS.LEGACY_LOCAL_URL),
    removeSecureItem(STORAGE_KEYS.LEGACY_VPN_URL),
  ]);
}

/**
 * Builds WebSocket URL from base URL and token.
 */
export function buildWebSocketUrl(baseUrl: string, token: string): string {
  const normalizedBaseUrl = normalizeServerBaseUrl(baseUrl);
  const wsProtocol = normalizedBaseUrl.startsWith("https") ? "wss" : "ws";
  const cleanBase = normalizedBaseUrl.replace(/^https?:\/\//, "");
  return `${wsProtocol}://${cleanBase}/ws?token=${encodeURIComponent(token)}`;
}

/**
 * Creates a pending access request on the selected server.
 */
export async function requestAccess(
  serverBaseUrl: string,
  deviceName: string,
): Promise<MobileAccessRequestState> {
  const normalizedServerBaseUrl = normalizeServerBaseUrl(serverBaseUrl);
  const url = `${normalizedServerBaseUrl}/api/mobile/access/request`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceName }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `HTTP ${response.status}`;
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.message || errorJson.error || errorMessage;
      } catch {
        if (errorText) errorMessage += `: ${errorText}`;
      }
      throw new Error(errorMessage);
    }

    return response.json();
  } catch (err) {
    if (err instanceof TypeError) {
      throw toNetworkError(normalizedServerBaseUrl, err);
    }
    throw err;
  }
}

/**
 * Loads the current access request status from the server.
 */
export async function getAccessRequest(
  serverBaseUrl: string,
  requestId: string,
): Promise<MobileAccessRequestState> {
  const normalizedServerBaseUrl = normalizeServerBaseUrl(serverBaseUrl);
  const url = `${normalizedServerBaseUrl}/api/mobile/access/status`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId }),
    });
  } catch (err) {
    if (err instanceof TypeError) {
      throw toNetworkError(normalizedServerBaseUrl, err);
    }
    throw err;
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Unable to load access request status (HTTP ${response.status})${errorText ? `: ${errorText}` : ""}`,
    );
  }

  return response.json();
}

/**
 * Refreshes the access token using the refresh token.
 */
export async function refreshSessionToken(
  serverBaseUrl: string,
  refreshToken: string,
): Promise<MobileSessionBundle> {
  const normalizedServerBaseUrl = normalizeServerBaseUrl(serverBaseUrl);
  const url = `${normalizedServerBaseUrl}/api/mobile/token/refresh`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
  } catch (err) {
    if (err instanceof TypeError) {
      throw toNetworkError(normalizedServerBaseUrl, err);
    }
    throw err;
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token refresh failed${errorText ? `: ${errorText}` : ""}`);
  }

  return response.json();
}

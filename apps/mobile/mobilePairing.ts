import * as SecureStore from "expo-secure-store";

export interface MobileSessionBundle {
  readonly deviceId: string;
  readonly accessToken: string;
  readonly accessTokenExpiresAt: string;
  readonly refreshToken: string;
}

export interface MobileSettings {
  readonly connectionMode: MobileConnectionMode;
  readonly localServerBaseUrl: string;
  readonly vpnServerBaseUrl: string;
  readonly deviceName: string;
  readonly lastKnownGoodTarget: MobileConnectionTarget | null;
  readonly lastPairingCode: string;
}

export type MobileConnectionMode = "auto" | "local" | "vpn";
export type MobileConnectionTarget = "local" | "vpn";

export interface MobileConnectionCandidate {
  readonly target: MobileConnectionTarget;
  readonly serverBaseUrl: string;
}

/**
 * Returns a compact human label for the connection target.
 */
export function describeConnectionTarget(target: MobileConnectionTarget): string {
  return target === "vpn" ? "VPN" : "Local";
}

const MOBILE_SESSION_KEY = "t3.mobile.session";
const MOBILE_SETTINGS_KEY = "t3.mobile.settings";

/**
 * Builds a canonical HTTP base URL from user input.
 */
export function normalizeServerBaseUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Server URL is required.");
  }
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const parsed = new URL(withProtocol);
  parsed.pathname = "";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

/**
 * Converts an HTTP endpoint into a WebSocket endpoint with token query auth.
 */
export function buildWebSocketUrl(serverBaseUrl: string, accessToken: string): string {
  const parsed = new URL(serverBaseUrl);
  parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  parsed.pathname = "/";
  parsed.search = "";
  parsed.searchParams.set("token", accessToken);
  return parsed.toString();
}

/**
 * Exchanges a pairing code for persistent mobile session credentials.
 */
export async function exchangePairingCode(input: {
  readonly serverBaseUrl: string;
  readonly pairingCode: string;
  readonly deviceName: string;
}): Promise<MobileSessionBundle> {
  const response = await fetch(`${input.serverBaseUrl}/api/mobile/pairing/exchange`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      pairingCode: input.pairingCode,
      deviceName: input.deviceName,
    }),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to exchange pairing code."));
  }

  return (await readJsonResponse(
    response,
    "Failed to read pairing exchange response.",
  )) as MobileSessionBundle;
}

/**
 * Rotates refresh credentials and returns a fresh access token bundle.
 */
export async function refreshSessionToken(input: {
  readonly serverBaseUrl: string;
  readonly refreshToken: string;
}): Promise<MobileSessionBundle> {
  const response = await fetch(`${input.serverBaseUrl}/api/mobile/token/refresh`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ refreshToken: input.refreshToken }),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to refresh mobile token."));
  }

  return (await readJsonResponse(
    response,
    "Failed to read token refresh response.",
  )) as MobileSessionBundle;
}

/**
 * Persists mobile credentials in secure storage.
 */
export async function saveSession(bundle: MobileSessionBundle): Promise<void> {
  await SecureStore.setItemAsync(MOBILE_SESSION_KEY, JSON.stringify(bundle));
}

/**
 * Loads persisted mobile credentials if present.
 */
export async function loadSession(): Promise<MobileSessionBundle | null> {
  const raw = await SecureStore.getItemAsync(MOBILE_SESSION_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as MobileSessionBundle;
    if (
      !parsed.accessToken ||
      !parsed.refreshToken ||
      !parsed.deviceId ||
      !parsed.accessTokenExpiresAt
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Clears persisted mobile credentials.
 */
export async function clearSession(): Promise<void> {
  await SecureStore.deleteItemAsync(MOBILE_SESSION_KEY);
}

/**
 * Persists mobile companion settings in secure storage.
 */
export async function saveSettings(settings: MobileSettings): Promise<void> {
  await SecureStore.setItemAsync(MOBILE_SETTINGS_KEY, JSON.stringify(settings));
}

/**
 * Loads persisted mobile companion settings.
 */
export async function loadSettings(): Promise<MobileSettings | null> {
  const raw = await SecureStore.getItemAsync(MOBILE_SETTINGS_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<MobileSettings> & {
      serverBaseUrl?: string;
      tailnetServerBaseUrl?: string;
    };
    const legacyConnectionMode = (parsed as { connectionMode?: string }).connectionMode;
    const legacyLastKnownGoodTarget = (parsed as { lastKnownGoodTarget?: string | null })
      .lastKnownGoodTarget;
    if (typeof parsed.deviceName !== "string") {
      return null;
    }
    const mode =
      legacyConnectionMode === "auto" ||
      legacyConnectionMode === "local" ||
      legacyConnectionMode === "vpn"
        ? legacyConnectionMode
        : legacyConnectionMode === "tailnet"
          ? "vpn"
          : "auto";
    const localServerBaseUrl =
      typeof parsed.localServerBaseUrl === "string"
        ? parsed.localServerBaseUrl
        : typeof parsed.serverBaseUrl === "string"
          ? parsed.serverBaseUrl
          : "http://127.0.0.1:3773";
    const vpnServerBaseUrl =
      typeof parsed.vpnServerBaseUrl === "string"
        ? parsed.vpnServerBaseUrl
        : typeof parsed.tailnetServerBaseUrl === "string"
          ? parsed.tailnetServerBaseUrl
          : "";
    const lastKnownGoodTarget =
      legacyLastKnownGoodTarget === "local" || legacyLastKnownGoodTarget === "vpn"
        ? legacyLastKnownGoodTarget
        : legacyLastKnownGoodTarget === "tailnet"
          ? "vpn"
          : null;
    return {
      connectionMode: mode,
      localServerBaseUrl,
      vpnServerBaseUrl,
      deviceName: parsed.deviceName,
      lastKnownGoodTarget,
      lastPairingCode: typeof parsed.lastPairingCode === "string" ? parsed.lastPairingCode : "",
    };
  } catch {
    return null;
  }
}

/**
 * Resolves normalized endpoint candidates based on mode and available URLs.
 */
export function resolveConnectionCandidates(input: {
  readonly connectionMode: MobileConnectionMode;
  readonly localServerBaseUrl: string;
  readonly vpnServerBaseUrl: string;
  readonly lastKnownGoodTarget: MobileConnectionTarget | null;
}): ReadonlyArray<MobileConnectionCandidate> {
  const byTarget = {
    local: toNormalizedCandidate("local", input.localServerBaseUrl),
    vpn: toNormalizedCandidate("vpn", input.vpnServerBaseUrl),
  } as const;

  const pushCandidate = (
    target: MobileConnectionTarget,
    list: MobileConnectionCandidate[],
    seen: Set<MobileConnectionTarget>,
  ) => {
    const candidate = byTarget[target];
    if (!candidate || seen.has(target)) {
      return;
    }
    seen.add(target);
    list.push(candidate);
  };

  const candidates: MobileConnectionCandidate[] = [];
  const seen = new Set<MobileConnectionTarget>();

  if (input.connectionMode === "local") {
    pushCandidate("local", candidates, seen);
    return candidates;
  }

  if (input.connectionMode === "vpn") {
    pushCandidate("vpn", candidates, seen);
    return candidates;
  }

  if (input.lastKnownGoodTarget) {
    pushCandidate(input.lastKnownGoodTarget, candidates, seen);
  }
  pushCandidate("vpn", candidates, seen);
  pushCandidate("local", candidates, seen);

  return candidates;
}

/**
 * Runs a task across ordered endpoint candidates until one succeeds.
 */
export async function executeWithConnectionCandidates<T>(input: {
  readonly taskName: string;
  readonly candidates: ReadonlyArray<MobileConnectionCandidate>;
  readonly task: (candidate: MobileConnectionCandidate) => Promise<T>;
}): Promise<{ readonly candidate: MobileConnectionCandidate; readonly result: T }> {
  if (input.candidates.length <= 0) {
    throw new Error("No reachable endpoint configured. Set local or VPN URL first.");
  }

  const failureMessages: string[] = [];
  for (const candidate of input.candidates) {
    try {
      const result = await input.task(candidate);
      return { candidate, result };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      failureMessages.push(`${describeConnectionTarget(candidate.target)}: ${reason}`);
    }
  }

  throw new Error(`Failed to ${input.taskName} across endpoints. ${failureMessages.join(" | ")}`);
}

function toNormalizedCandidate(
  target: MobileConnectionTarget,
  baseUrl: string,
): MobileConnectionCandidate | null {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return null;
  }
  return {
    target,
    serverBaseUrl: normalizeServerBaseUrl(trimmed),
  };
}

/**
 * Reads an API error payload into a user-facing message.
 */
async function readErrorMessage(response: Response, fallbackMessage: string): Promise<string> {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as { error?: string };
    if (typeof parsed.error === "string" && parsed.error.length > 0) {
      return parsed.error;
    }
    if (text.trim().startsWith("<")) {
      return `${fallbackMessage} Received HTML instead of JSON. Check server URL/port.`;
    }
    return text || fallbackMessage;
  } catch {
    if (text.trim().startsWith("<")) {
      return `${fallbackMessage} Received HTML instead of JSON. Check server URL/port.`;
    }
    if (text.length > 0) {
      return text;
    }
    return fallbackMessage;
  }
}

/**
 * Parses a successful JSON response with a clearer message for HTML payloads.
 */
async function readJsonResponse(response: Response, fallbackMessage: string): Promise<unknown> {
  const text = await response.text();
  if (text.trim().startsWith("<")) {
    throw new Error(`${fallbackMessage} Received HTML instead of JSON. Check server URL/port.`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(fallbackMessage);
  }
}

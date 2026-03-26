import { useCallback, useEffect, useRef, useState } from "react";

import {
  buildWebSocketUrl,
  clearSession,
  describeConnectionTarget,
  executeWithConnectionCandidates,
  exchangePairingCode,
  loadSession,
  loadSettings,
  refreshSessionToken,
  resolveConnectionCandidates,
  saveSession,
  saveSettings,
  type MobileConnectionCandidate,
  type MobileConnectionMode,
  type MobileConnectionTarget,
  type MobileSessionBundle,
} from "./mobilePairing";

interface ServerWelcomePushPayload {
  readonly connectionKind?: "desktop" | "mobile" | "anonymous";
  readonly connectionDeviceId?: string;
  readonly connectionDeviceName?: string;
}

interface SocketPushEnvelope {
  readonly type?: string;
  readonly channel?: string;
  readonly data?: ServerWelcomePushPayload;
}

/**
 * Converts unknown thrown values into readable status text.
 */
function toStatusErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Maps welcome payload identity fields into a display label.
 */
function resolveConnectedIdentity(payload: ServerWelcomePushPayload | undefined): string {
  if (!payload) {
    return "unknown";
  }
  const kind = payload.connectionKind;
  if (kind === "mobile") {
    if (payload.connectionDeviceName?.trim().length) {
      return payload.connectionDeviceName;
    }
    if (payload.connectionDeviceId) {
      return `mobile:${payload.connectionDeviceId.slice(0, 8)}...`;
    }
    return "mobile";
  }
  if (kind === "desktop") {
    return "desktop";
  }
  if (kind === "anonymous") {
    return "anonymous";
  }
  return "unknown";
}

/**
 * Provides mobile companion session state and actions.
 */
export function useCompanionController() {
  const [connectionMode, setConnectionMode] = useState<MobileConnectionMode>("auto");
  const [localServerBaseUrl, setLocalServerBaseUrl] = useState("http://127.0.0.1:3773");
  const [vpnServerBaseUrl, setVpnServerBaseUrl] = useState("");
  const [deviceName, setDeviceName] = useState("ios-simulator");
  const [lastKnownGoodTarget, setLastKnownGoodTarget] = useState<MobileConnectionTarget | null>(
    null,
  );
  const [activeEndpointTarget, setActiveEndpointTarget] = useState<MobileConnectionTarget | null>(
    null,
  );
  const [pairingCode, setPairingCode] = useState("");
  const [sessionBundle, setSessionBundle] = useState<MobileSessionBundle | null>(null);
  const [socketState, setSocketState] = useState("disconnected");
  const [statusMessage, setStatusMessage] = useState(
    "Ready. In iOS Simulator, pair by pasting a code from desktop/web.",
  );
  const [hasLoadedPersistedState, setHasLoadedPersistedState] = useState(false);
  const [showAdvancedNetworkSettings, setShowAdvancedNetworkSettings] = useState(false);
  const [lastPushChannel, setLastPushChannel] = useState<string | null>(null);
  const [connectedIdentity, setConnectedIdentity] = useState<string>("unknown");
  const [isBusy, setIsBusy] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const hasAutoAttemptedRef = useRef(false);
  const handleConnectRef = useRef<() => Promise<void>>(async () => undefined);
  const handlePairDeviceRef = useRef<() => Promise<void>>(async () => undefined);

  /**
   * Loads persisted settings and session state once during startup.
   */
  useEffect(() => {
    void (async () => {
      const [storedSettings, storedSession] = await Promise.all([loadSettings(), loadSession()]);
      if (storedSettings) {
        setConnectionMode(storedSettings.connectionMode);
        setLocalServerBaseUrl(storedSettings.localServerBaseUrl);
        setVpnServerBaseUrl(storedSettings.vpnServerBaseUrl);
        setDeviceName(storedSettings.deviceName);
        setLastKnownGoodTarget(storedSettings.lastKnownGoodTarget);
        setPairingCode(storedSettings.lastPairingCode);
      }
      if (storedSession) {
        setSessionBundle(storedSession);
        setStatusMessage("Loaded saved mobile session. Connecting...");
      }
      setHasLoadedPersistedState(true);
    })();

    return () => {
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, []);

  /**
   * Persists current editable settings to secure storage.
   */
  const persistSettings = useCallback(
    async (target: MobileConnectionTarget | null) => {
      await saveSettings({
        connectionMode,
        localServerBaseUrl,
        vpnServerBaseUrl,
        deviceName,
        lastKnownGoodTarget: target,
        lastPairingCode: pairingCode,
      });
    },
    [connectionMode, deviceName, localServerBaseUrl, pairingCode, vpnServerBaseUrl],
  );

  /**
   * Updates the remembered best target and persists settings.
   */
  const persistSettingsWithLastKnown = useCallback(
    async (target: MobileConnectionTarget | null) => {
      setLastKnownGoodTarget(target);
      await persistSettings(target);
    },
    [persistSettings],
  );

  /**
   * Persists current settings whenever editable fields change.
   */
  useEffect(() => {
    if (!hasLoadedPersistedState) {
      return;
    }
    void persistSettings(lastKnownGoodTarget);
  }, [
    connectionMode,
    deviceName,
    hasLoadedPersistedState,
    lastKnownGoodTarget,
    localServerBaseUrl,
    pairingCode,
    persistSettings,
    vpnServerBaseUrl,
  ]);

  /**
   * Resolves ordered candidate endpoints from current preference state.
   */
  const resolveCandidates = (): ReadonlyArray<MobileConnectionCandidate> => {
    return resolveConnectionCandidates({
      connectionMode,
      localServerBaseUrl,
      vpnServerBaseUrl,
      lastKnownGoodTarget,
    });
  };

  /**
   * Connects the WebSocket using the provided session bundle.
   */
  const connectWithSession = async (
    bundle: MobileSessionBundle,
    candidate: MobileConnectionCandidate,
  ) => {
    setSocketState("connecting");
    setConnectedIdentity("unknown");
    socketRef.current?.close();
    const wsUrl = buildWebSocketUrl(candidate.serverBaseUrl, bundle.accessToken);
    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;

    socket.addEventListener("message", (event) => {
      if (socketRef.current !== socket) {
        return;
      }
      try {
        const parsed = JSON.parse(String(event.data)) as SocketPushEnvelope;
        if (parsed.type === "push" && typeof parsed.channel === "string") {
          setLastPushChannel(parsed.channel);
          if (parsed.channel === "server.welcome") {
            setConnectedIdentity(resolveConnectedIdentity(parsed.data));
          }
        }
      } catch {
        setLastPushChannel("non-json-message");
      }
    });

    socket.addEventListener("close", () => {
      if (socketRef.current !== socket) {
        return;
      }
      socketRef.current = null;
      setSocketState("disconnected");
      setStatusMessage("Socket disconnected. Tap Connect to retry.");
    });

    await new Promise<void>((resolve, reject) => {
      const handleOpen = () => {
        if (socketRef.current !== socket) {
          return;
        }
        setSocketState("connected");
        setActiveEndpointTarget(candidate.target);
        setStatusMessage(`Connected via ${describeConnectionTarget(candidate.target)}.`);
        resolve();
      };

      const handleOpenError = () => {
        if (socketRef.current === socket) {
          setSocketState("error");
        }
        reject(new Error("WebSocket failed. Check server URL, token, and reachability."));
      };

      socket.addEventListener("open", handleOpen, { once: true });
      socket.addEventListener("error", handleOpenError, { once: true });
    });
  };

  /**
   * Pairs this device using a one-time pairing code.
   */
  const handlePairDevice = async () => {
    setIsBusy(true);
    try {
      const code = pairingCode.trim();
      if (!code) {
        throw new Error("Enter a pairing code first.");
      }
      const { candidate, result: bundle } = await executeWithConnectionCandidates({
        taskName: "pair device",
        candidates: resolveCandidates(),
        task: (endpoint) =>
          exchangePairingCode({
            serverBaseUrl: endpoint.serverBaseUrl,
            pairingCode: code,
            deviceName: deviceName.trim() || "ios-simulator",
          }),
      });
      setActiveEndpointTarget(candidate.target);
      await persistSettingsWithLastKnown(candidate.target);
      setSessionBundle(bundle);
      await saveSession(bundle);
      setStatusMessage(`Paired via ${describeConnectionTarget(candidate.target)}. Connecting...`);
      await connectWithSession(bundle, candidate);
    } catch (error) {
      setStatusMessage(toStatusErrorMessage(error));
    } finally {
      setIsBusy(false);
    }
  };

  /**
   * Connects using stored credentials and refreshes if expired.
   */
  const handleConnect = async () => {
    setIsBusy(true);
    try {
      if (!sessionBundle) {
        throw new Error("No session saved. Pair this device first.");
      }

      const isExpired = Date.parse(sessionBundle.accessTokenExpiresAt) <= Date.now();
      const resolved = await executeWithConnectionCandidates({
        taskName: isExpired ? "refresh token" : "connect",
        candidates: resolveCandidates(),
        task: (endpoint) => {
          if (!isExpired) {
            return Promise.resolve(sessionBundle);
          }
          return refreshSessionToken({
            serverBaseUrl: endpoint.serverBaseUrl,
            refreshToken: sessionBundle.refreshToken,
          });
        },
      });
      const candidate = resolved.candidate;
      const activeBundle = resolved.result;

      if (isExpired) {
        setStatusMessage(
          `Access token refreshed via ${describeConnectionTarget(candidate.target)}. Connecting...`,
        );
        setSessionBundle(activeBundle);
        await saveSession(activeBundle);
      }

      await persistSettingsWithLastKnown(candidate.target);
      await connectWithSession(activeBundle, candidate);
    } catch (error) {
      setStatusMessage(toStatusErrorMessage(error));
      setSocketState("error");
    } finally {
      setIsBusy(false);
    }
  };

  handleConnectRef.current = handleConnect;
  handlePairDeviceRef.current = handlePairDevice;

  /**
   * Disconnects the active socket.
   */
  const handleDisconnect = () => {
    socketRef.current?.close();
    socketRef.current = null;
    setSocketState("disconnected");
    setActiveEndpointTarget(null);
    setConnectedIdentity("unknown");
    setStatusMessage("Disconnected.");
  };

  /**
   * Clears persisted mobile credentials and UI state.
   */
  const handleForgetSession = async () => {
    await clearSession();
    socketRef.current?.close();
    socketRef.current = null;
    setSessionBundle(null);
    setSocketState("disconnected");
    setActiveEndpointTarget(null);
    setConnectedIdentity("unknown");
    setLastPushChannel(null);
    setStatusMessage("Saved mobile session removed.");
  };

  /**
   * Automatically resumes by connecting an existing session or pairing from a saved code.
   */
  useEffect(() => {
    if (!hasLoadedPersistedState || hasAutoAttemptedRef.current || isBusy) {
      return;
    }
    if (sessionBundle) {
      hasAutoAttemptedRef.current = true;
      void handleConnectRef.current();
      return;
    }
    if (pairingCode.trim().length > 0) {
      hasAutoAttemptedRef.current = true;
      setStatusMessage("Pairing with saved code...");
      void handlePairDeviceRef.current();
    }
  }, [hasLoadedPersistedState, isBusy, pairingCode, sessionBundle]);

  return {
    connectionMode,
    localServerBaseUrl,
    vpnServerBaseUrl,
    deviceName,
    activeEndpointTarget,
    pairingCode,
    sessionBundle,
    socketState,
    statusMessage,
    showAdvancedNetworkSettings,
    lastPushChannel,
    connectedIdentity,
    isBusy,
    setConnectionMode,
    setLocalServerBaseUrl,
    setVpnServerBaseUrl,
    setDeviceName,
    setPairingCode,
    setShowAdvancedNetworkSettings,
    handlePairDevice,
    handleConnect,
    handleDisconnect,
    handleForgetSession,
  } as const;
}

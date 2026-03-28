import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ModelSelection,
  OrchestrationReadModel,
  OrchestrationSessionStatus,
} from "@t3tools/contracts";
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
} from "../lib/mobilePairing";

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

interface SocketResponseEnvelope {
  readonly id?: string;
  readonly result?: unknown;
  readonly error?: { readonly message?: string };
}

interface SessionSummary {
  readonly id: string;
  readonly title: string;
  readonly projectTitle: string;
  readonly status: OrchestrationSessionStatus | "inactive";
  readonly providerName: string;
  readonly updatedAt: string;
  readonly lastMessagePreview: string;
  readonly lastError: string | null;
}

interface PendingSocketRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

const ORCHESTRATION_GET_SNAPSHOT_METHOD = "orchestration.getSnapshot";
const ORCHESTRATION_DISPATCH_COMMAND_METHOD = "orchestration.dispatchCommand";
const ORCHESTRATION_DOMAIN_EVENT_CHANNEL = "orchestration.domainEvent";
const SERVER_WELCOME_CHANNEL = "server.welcome";

function createEntityId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function toThreadTitle(prompt: string): string {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  if (normalized.length <= 0) return "New session";
  return normalized.slice(0, 72);
}

function pickProjectForPrompt(readModel: OrchestrationReadModel) {
  const activeProjects = readModel.projects.filter((project) => project.deletedAt === null);
  return (
    [...activeProjects].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ??
    null
  );
}

function resolvePromptModelSelection(
  readModel: OrchestrationReadModel,
  projectId: string,
): ModelSelection {
  const activeThread = readModel.threads
    .filter((thread) => thread.deletedAt === null && thread.projectId === projectId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];

  if (activeThread) return activeThread.modelSelection;

  const project = readModel.projects.find((candidate) => candidate.id === projectId);
  if (project?.defaultModelSelection) return project.defaultModelSelection;

  return { provider: "codex", model: "gpt-5-codex" };
}

function toStatusErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resolveConnectedIdentity(payload: ServerWelcomePushPayload | undefined): string {
  if (!payload) return "unknown";
  const kind = payload.connectionKind;
  if (kind === "mobile" && payload.connectionDeviceName?.trim().length) {
    return payload.connectionDeviceName;
  }
  if (kind === "mobile") return "mobile";
  if (kind === "desktop") return "desktop";
  return kind ?? "unknown";
}

export function formatSessionStatus(status: OrchestrationSessionStatus | "inactive"): string {
  switch (status) {
    case "running":
      return "Running";
    case "starting":
      return "Starting";
    case "ready":
      return "Ready";
    case "interrupted":
      return "Interrupted";
    case "error":
      return "Error";
    case "idle":
      return "Idle";
    case "stopped":
      return "Stopped";
    case "inactive":
      return "Inactive";
  }
}

export function toStatusChipColor(status: OrchestrationSessionStatus | "inactive"): string {
  if (status === "running" || status === "starting") return "accent";
  if (status === "ready") return "success";
  if (status === "interrupted") return "warning";
  if (status === "error") return "danger";
  return "default";
}

function toSessionSummaries(readModel: OrchestrationReadModel): SessionSummary[] {
  const projectTitleById = new Map(
    readModel.projects.map((project) => [project.id, project.title]),
  );

  return (
    readModel.threads
      .filter((thread) => thread.deletedAt === null)
      .map((thread) => {
        const lastMessage = thread.messages[thread.messages.length - 1];
        const preview = lastMessage?.text?.trim() ?? "";
        return {
          id: thread.id,
          title: thread.title,
          projectTitle: projectTitleById.get(thread.projectId) ?? "Unknown project",
          status: (thread.session?.status ?? "inactive") as SessionSummary["status"],
          providerName: thread.session?.providerName ?? "none",
          updatedAt: thread.updatedAt,
          lastMessagePreview: preview.length > 0 ? preview : "(no messages yet)",
          lastError: thread.session?.lastError ?? null,
        };
      }) as SessionSummary[]
  ).sort((left, right) => {
    const byUpdatedAt = right.updatedAt.localeCompare(left.updatedAt);
    if (byUpdatedAt !== 0) return byUpdatedAt;
    return left.id.localeCompare(right.id);
  });
}

export function useCompanionController() {
  const [hasLoadedPersistedState, setHasLoadedPersistedState] = useState(false);
  const [connectionMode, setConnectionMode] = useState<MobileConnectionMode>("auto");
  const [localServerBaseUrl, setLocalServerBaseUrl] = useState("http://127.0.0.1:3773");
  const [vpnServerBaseUrl, setVpnServerBaseUrl] = useState("http://your-host.ts.net:3773");
  const [deviceName, setDeviceName] = useState("Mobile Device");
  const [pairingCode, setPairingCode] = useState("");
  const [sessionBundle, setSessionBundle] = useState<MobileSessionBundle | null>(null);
  const [socketState, setSocketState] = useState<
    "disconnected" | "connecting" | "connected" | "error"
  >("disconnected");
  const [activeEndpointTarget, setActiveEndpointTarget] = useState<MobileConnectionTarget | null>(
    null,
  );
  const [statusMessage, setStatusMessage] = useState("");
  const [showAdvancedNetworkSettings, setShowAdvancedNetworkSettings] = useState(false);
  const [lastPushChannel, setLastPushChannel] = useState<string | null>(null);
  const [connectedIdentity, setConnectedIdentity] = useState<string>("unknown");
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [isRefreshingSessions, setIsRefreshingSessions] = useState(false);
  const [isSubmittingPrompt, setIsSubmittingPrompt] = useState(false);
  const [isBusy, setIsBusy] = useState(false);

  const socketRef = useRef<WebSocket | null>(null);
  const hasAutoAttemptedRef = useRef(false);
  const handleConnectRef = useRef<() => Promise<void>>(async () => undefined);
  const handlePairDeviceRef = useRef<() => Promise<void>>(async () => undefined);
  const nextRequestIdRef = useRef(1);
  const pendingRequestsRef = useRef(new Map<string, PendingSocketRequest>());
  const refreshSessionsRef = useRef<() => Promise<void>>(async () => undefined);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const rejectPendingRequests = useCallback((message: string) => {
    for (const pending of pendingRequestsRef.current.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(message));
    }
    pendingRequestsRef.current.clear();
  }, []);

  const sendSocketRequest = useCallback(
    async <T>(
      socket: WebSocket,
      method: string,
      params: Record<string, unknown> = {},
    ): Promise<T> => {
      if (socket.readyState !== WebSocket.OPEN) {
        throw new Error("Socket is not connected.");
      }

      const id = String(nextRequestIdRef.current++);
      const payload = JSON.stringify({
        id,
        body: { ...params, _tag: method },
      });

      return new Promise<T>((resolve, reject) => {
        const timeout = setTimeout(() => {
          pendingRequestsRef.current.delete(id);
          reject(new Error(`Request timed out: ${method}`));
        }, 10000);

        pendingRequestsRef.current.set(id, {
          resolve: resolve as (value: unknown) => void,
          reject,
          timeout,
        });

        try {
          socket.send(payload);
        } catch (error) {
          clearTimeout(timeout);
          pendingRequestsRef.current.delete(id);
          reject(error instanceof Error ? error : new Error("Failed to send request."));
        }
      });
    },
    [],
  );

  const refreshSessions = useCallback(async () => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    setIsRefreshingSessions(true);
    try {
      const snapshot = await sendSocketRequest<OrchestrationReadModel>(
        socket,
        ORCHESTRATION_GET_SNAPSHOT_METHOD,
      );
      setSessions(toSessionSummaries(snapshot));
    } catch (error) {
      setStatusMessage(toStatusErrorMessage(error));
    } finally {
      setIsRefreshingSessions(false);
    }
  }, [sendSocketRequest]);

  refreshSessionsRef.current = refreshSessions;

  const scheduleRefreshSessions = useCallback(() => {
    if (refreshTimerRef.current !== null) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      void refreshSessionsRef.current();
    }, 250);
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadSettings().then((settings) => {
      if (cancelled) return;
      setConnectionMode(settings.connectionMode);
      setLocalServerBaseUrl(settings.localServerBaseUrl);
      setVpnServerBaseUrl(settings.vpnServerBaseUrl);
      setDeviceName(settings.deviceName);
    });
    loadSession().then((bundle) => {
      if (cancelled) return;
      setSessionBundle(bundle);
      setHasLoadedPersistedState(true);
    });
    return () => {
      cancelled = true;
      if (refreshTimerRef.current !== null) clearTimeout(refreshTimerRef.current);
      rejectPendingRequests("Socket closed.");
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [rejectPendingRequests]);

  const persistSettingsWithLastKnown = async (_target: MobileConnectionTarget) => {
    await saveSettings({
      connectionMode,
      localServerBaseUrl,
      vpnServerBaseUrl,
      deviceName,
    });
  };

  const connectWithSession = async (
    bundle: MobileSessionBundle,
    candidate: MobileConnectionCandidate,
  ) => {
    return new Promise<void>((resolve, reject) => {
      socketRef.current?.close();
      rejectPendingRequests("Socket restarted.");
      const wsUrl = buildWebSocketUrl(candidate.serverBaseUrl, bundle.accessToken);
      const socket = new WebSocket(wsUrl);
      socketRef.current = socket;

      socket.addEventListener("message", (event) => {
        try {
          const parsed = JSON.parse(String(event.data)) as SocketPushEnvelope;
          const parsedResponse = parsed as SocketResponseEnvelope;
          if (typeof parsedResponse.id === "string") {
            const pending = pendingRequestsRef.current.get(parsedResponse.id);
            if (pending) {
              clearTimeout(pending.timeout);
              pendingRequestsRef.current.delete(parsedResponse.id);
              if (parsedResponse.error?.message)
                pending.reject(new Error(parsedResponse.error.message));
              else pending.resolve(parsedResponse.result);
              return;
            }
          }
          if (parsed.type === "push" && typeof parsed.channel === "string") {
            setLastPushChannel(parsed.channel);
            if (parsed.channel === SERVER_WELCOME_CHANNEL) {
              setConnectedIdentity(resolveConnectedIdentity(parsed.data));
            }
            if (parsed.channel === ORCHESTRATION_DOMAIN_EVENT_CHANNEL) {
              scheduleRefreshSessions();
            }
          }
        } catch {
          // Ignore parse errors
        }
      });

      socket.addEventListener("close", () => {
        socketRef.current = null;
        rejectPendingRequests("Socket closed.");
        setSocketState("disconnected");
        setStatusMessage("Socket disconnected. Tap Connect to retry.");
      });

      socket.addEventListener("open", () => {
        setSocketState("connected");
        setActiveEndpointTarget(candidate.target);
        setStatusMessage(`Connected via ${describeConnectionTarget(candidate.target)}.`);
        void refreshSessionsRef.current();
        resolve();
      });

      socket.addEventListener("error", () => {
        if (socketRef.current === socket) {
          setSocketState("error");
        }
        rejectPendingRequests("Socket failed to connect.");
        reject(new Error("WebSocket failed. Check server URL, token, and reachability."));
      });
    });
  };

  const handlePairDevice = async () => {
    console.log("[PAIR] Starting pair device...");
    console.log("[PAIR] Device name:", deviceName);
    console.log("[PAIR] Connection mode:", connectionMode);
    console.log("[PAIR] Local URL:", localServerBaseUrl);
    console.log("[PAIR] VPN URL:", vpnServerBaseUrl);

    const trimmedCode = pairingCode.trim();
    if (!trimmedCode) {
      console.log("[PAIR] Error: No pairing code");
      setStatusMessage("Enter a pairing code first.");
      return;
    }
    if (!deviceName.trim()) {
      console.log("[PAIR] Error: No device name");
      setStatusMessage("Enter a device name first.");
      return;
    }

    setIsBusy(true);
    try {
      const candidates = resolveConnectionCandidates(
        connectionMode,
        localServerBaseUrl,
        vpnServerBaseUrl,
        null,
      );
      console.log("[PAIR] Candidates:", candidates);

      if (candidates.length === 0) {
        throw new Error("Configure at least one server URL (Local or VPN).");
      }

      console.log("[PAIR] Attempting to exchange pairing code...");
      const { candidate, result: bundle } = await executeWithConnectionCandidates(candidates, (c) =>
        exchangePairingCode(c.serverBaseUrl, deviceName, trimmedCode),
      );

      console.log("[PAIR] Success! Saving session...");
      await saveSession(bundle);
      await persistSettingsWithLastKnown(candidate.target);
      setSessionBundle(bundle);
      setPairingCode("");
      setStatusMessage("Paired successfully. Connecting...");
      await connectWithSession(bundle, candidate);
    } catch (error) {
      console.error("[PAIR] Error:", error);
      setStatusMessage(toStatusErrorMessage(error));
      setSocketState("error");
    } finally {
      setIsBusy(false);
    }
  };

  handlePairDeviceRef.current = handlePairDevice;

  const handleConnect = async () => {
    if (!sessionBundle) {
      setStatusMessage("Pair first to obtain session credentials.");
      return;
    }

    setIsBusy(true);
    try {
      const candidates = resolveConnectionCandidates(
        connectionMode,
        localServerBaseUrl,
        vpnServerBaseUrl,
        activeEndpointTarget,
      );
      if (candidates.length === 0) {
        throw new Error("Configure at least one server URL (Local or VPN).");
      }

      let activeBundle = sessionBundle;
      await executeWithConnectionCandidates(candidates, async (c) => {
        const refreshed = await refreshSessionToken(c.serverBaseUrl, activeBundle.refreshToken);
        activeBundle = refreshed;
        await saveSession(refreshed);
        setSessionBundle(refreshed);
      });

      const target = activeEndpointTarget ?? candidates[0]?.target ?? "local";
      await persistSettingsWithLastKnown(target);
      await connectWithSession(activeBundle, candidates[0]!);
    } catch (error) {
      setStatusMessage(toStatusErrorMessage(error));
      setSocketState("error");
    } finally {
      setIsBusy(false);
    }
  };

  handleConnectRef.current = handleConnect;

  const handleDisconnect = () => {
    socketRef.current?.close();
    socketRef.current = null;
    rejectPendingRequests("Socket disconnected.");
    setSocketState("disconnected");
    setActiveEndpointTarget(null);
    setConnectedIdentity("unknown");
    setSessions([]);
    setStatusMessage("Disconnected.");
  };

  const handleForgetSession = async () => {
    await clearSession();
    socketRef.current?.close();
    socketRef.current = null;
    rejectPendingRequests("Session forgotten.");
    setSessionBundle(null);
    setSocketState("disconnected");
    setActiveEndpointTarget(null);
    setConnectedIdentity("unknown");
    setLastPushChannel(null);
    setSessions([]);
    setStatusMessage("Saved mobile session removed.");
  };

  const handleStartPrompt = async (prompt: string): Promise<boolean> => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      setStatusMessage("Enter a prompt first.");
      return false;
    }

    setIsSubmittingPrompt(true);
    try {
      if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
        await handleConnectRef.current();
      }

      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        throw new Error("Connect before starting a session.");
      }

      const snapshot = await sendSocketRequest<OrchestrationReadModel>(
        socket,
        ORCHESTRATION_GET_SNAPSHOT_METHOD,
      );
      const project = pickProjectForPrompt(snapshot);
      if (!project) {
        throw new Error("No project available. Add a project from web or desktop first.");
      }

      const threadId = createEntityId("thread");
      const createdAt = new Date().toISOString();
      const modelSelection = resolvePromptModelSelection(snapshot, project.id);

      await sendSocketRequest(socket, ORCHESTRATION_DISPATCH_COMMAND_METHOD, {
        command: {
          type: "thread.create",
          commandId: createEntityId("command"),
          threadId,
          projectId: project.id,
          title: toThreadTitle(trimmedPrompt),
          modelSelection,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt,
        },
      });

      await sendSocketRequest(socket, ORCHESTRATION_DISPATCH_COMMAND_METHOD, {
        command: {
          type: "thread.turn.start",
          commandId: createEntityId("command"),
          threadId,
          message: {
            messageId: createEntityId("message"),
            role: "user",
            text: trimmedPrompt,
            attachments: [],
          },
          modelSelection,
          assistantDeliveryMode: "streaming",
          runtimeMode: "full-access",
          interactionMode: "default",
          createdAt,
        },
      });

      setStatusMessage("Session started.");
      await refreshSessionsRef.current();
      return true;
    } catch (error) {
      setStatusMessage(toStatusErrorMessage(error));
      return false;
    } finally {
      setIsSubmittingPrompt(false);
    }
  };

  useEffect(() => {
    if (!hasLoadedPersistedState || hasAutoAttemptedRef.current || isBusy) return;
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
    sessions,
    isRefreshingSessions,
    isSubmittingPrompt,
    formatSessionStatus,
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
    handleRefreshSessions: refreshSessions,
    handleStartPrompt,
  } as const;
}

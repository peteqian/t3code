import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ModelSelection,
  OrchestrationReadModel,
  OrchestrationSessionStatus,
} from "@t3tools/contracts";
import type { StatusTone } from "@t3tools/ui";
import {
  buildWebSocketUrl,
  clearSession,
  getAccessRequest,
  loadSession,
  loadSettings,
  requestAccess,
  refreshSessionToken,
  saveSession,
  saveSettings,
  type MobileAccessRequestState,
  type MobileSessionBundle,
} from "../lib/mobilePairing";
import { scanServers } from "../lib/mobileDiscovery";
import type { MobileDiscoveredServer } from "@t3tools/contracts";

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
const DEFAULT_LOCAL_SERVER_URL = "http://127.0.0.1:3773";

function createEntityId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function toThreadTitle(prompt: string): string {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  if (normalized.length <= 0) return "New session";
  return normalized.slice(0, 72);
}

function pickNewestItem<Value extends { readonly updatedAt: string }>(
  values: readonly Value[],
): Value | null {
  let newest: Value | null = null;

  for (const value of values) {
    if (!newest || value.updatedAt.localeCompare(newest.updatedAt) > 0) {
      newest = value;
    }
  }

  return newest;
}

function pickProjectForPrompt(readModel: OrchestrationReadModel) {
  const activeProjects = readModel.projects.filter((project) => project.deletedAt === null);
  return pickNewestItem(activeProjects);
}

function resolvePromptModelSelection(
  readModel: OrchestrationReadModel,
  projectId: string,
): ModelSelection {
  const activeThread = pickNewestItem(
    readModel.threads.filter(
      (thread) => thread.deletedAt === null && thread.projectId === projectId,
    ),
  );

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

function isLoopbackServerBaseUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return true;
  }

  return (
    trimmed.startsWith("http://127.0.0.1") ||
    trimmed.startsWith("https://127.0.0.1") ||
    trimmed.startsWith("http://localhost") ||
    trimmed.startsWith("https://localhost")
  );
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

export function toStatusChipColor(status: OrchestrationSessionStatus | "inactive"): StatusTone {
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

  const summaries: SessionSummary[] = [];

  for (const thread of readModel.threads) {
    if (thread.deletedAt !== null) {
      continue;
    }

    const lastMessage = thread.messages[thread.messages.length - 1];
    const preview = lastMessage?.text?.trim() ?? "";
    const summary: SessionSummary = {
      id: thread.id,
      title: thread.title,
      projectTitle: projectTitleById.get(thread.projectId) ?? "Unknown project",
      status: (thread.session?.status ?? "inactive") as SessionSummary["status"],
      providerName: thread.session?.providerName ?? "none",
      updatedAt: thread.updatedAt,
      lastMessagePreview: preview.length > 0 ? preview : "(no messages yet)",
      lastError: thread.session?.lastError ?? null,
    };

    let insertIndex = summaries.length;
    for (let index = 0; index < summaries.length; index += 1) {
      const current = summaries[index];
      const byUpdatedAt = summary.updatedAt.localeCompare(current.updatedAt);
      if (byUpdatedAt > 0 || (byUpdatedAt === 0 && summary.id.localeCompare(current.id) < 0)) {
        insertIndex = index;
        break;
      }
    }

    summaries.splice(insertIndex, 0, summary);
  }

  return summaries;
}

export function useCompanionController() {
  const [hasLoadedPersistedState, setHasLoadedPersistedState] = useState(false);
  const [serverBaseUrl, setServerBaseUrl] = useState(DEFAULT_LOCAL_SERVER_URL);
  const [deviceName, setDeviceName] = useState("Mobile Device");
  const [accessRequest, setAccessRequest] = useState<MobileAccessRequestState | null>(null);
  const [sessionBundle, setSessionBundle] = useState<MobileSessionBundle | null>(null);
  const [socketState, setSocketState] = useState<
    "disconnected" | "connecting" | "connected" | "error"
  >("disconnected");
  const [statusMessage, setStatusMessage] = useState("");
  const [showAdvancedNetworkSettings, setShowAdvancedNetworkSettings] = useState(false);
  const [lastPushChannel, setLastPushChannel] = useState<string | null>(null);
  const [connectedIdentity, setConnectedIdentity] = useState<string>("unknown");
  const [discoveredServers, setDiscoveredServers] = useState<ReadonlyArray<MobileDiscoveredServer>>(
    [],
  );
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [isRefreshingSessions, setIsRefreshingSessions] = useState(false);
  const [isScanningServers, setIsScanningServers] = useState(false);
  const [isSubmittingPrompt, setIsSubmittingPrompt] = useState(false);
  const [isBusy, setIsBusy] = useState(false);

  const socketRef = useRef<WebSocket | null>(null);
  const hasAutoAttemptedRef = useRef(false);
  const handleConnectRef = useRef<() => Promise<void>>(async () => undefined);
  const nextRequestIdRef = useRef(1);
  const pendingRequestsRef = useRef(new Map<string, PendingSocketRequest>());
  const refreshSessionsRef = useRef<() => Promise<void>>(async () => undefined);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectPromiseRef = useRef<Promise<void> | null>(null);

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
      setServerBaseUrl(settings.serverBaseUrl);
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

  const persistSettings = async () => {
    await saveSettings({
      serverBaseUrl,
      deviceName,
    });
  };

  const handleScanServers = useCallback(async () => {
    setIsScanningServers(true);

    try {
      const servers = await scanServers();
      setDiscoveredServers(servers);

      if (servers.length > 0 && isLoopbackServerBaseUrl(serverBaseUrl)) {
        setServerBaseUrl(servers[0]!.baseUrl);
        setStatusMessage(`Using nearby server ${servers[0]!.baseUrl}`);
      }
    } catch (error) {
      setStatusMessage(toStatusErrorMessage(error));
    } finally {
      setIsScanningServers(false);
    }
  }, [serverBaseUrl]);

  const connectWithSession = async (bundle: MobileSessionBundle) => {
    if (connectPromiseRef.current) {
      return connectPromiseRef.current;
    }

    setSocketState("connecting");

    const connectPromise = new Promise<void>((resolve, reject) => {
      let settled = false;

      const finishResolve = () => {
        if (settled) return;
        settled = true;
        connectPromiseRef.current = null;
        resolve();
      };

      const finishReject = (error: Error) => {
        if (settled) return;
        settled = true;
        connectPromiseRef.current = null;
        reject(error);
      };

      socketRef.current?.close();
      rejectPendingRequests("Socket restarted.");
      const wsUrl = buildWebSocketUrl(serverBaseUrl, bundle.accessToken);
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
        if (!settled) {
          finishReject(new Error("WebSocket closed before it connected."));
        }
      });

      socket.addEventListener("open", () => {
        setSocketState("connected");
        setStatusMessage("Connected.");
        void refreshSessionsRef.current();
        finishResolve();
      });

      socket.addEventListener("error", () => {
        if (socketRef.current === socket) {
          setSocketState("error");
        }
        rejectPendingRequests("Socket failed to connect.");
        finishReject(new Error("WebSocket failed. Check server URL, token, and reachability."));
      });
    });

    connectPromiseRef.current = connectPromise;
    return connectPromise;
  };

  const waitForApproval = useCallback(
    async (requestId: string): Promise<MobileSessionBundle> => {
      const startedAt = Date.now();

      while (Date.now() - startedAt < 120_000) {
        const current = await getAccessRequest(serverBaseUrl, requestId);
        setAccessRequest(current);

        if (current.status === "approved" && current.session) {
          return current.session;
        }

        if (current.status === "rejected") {
          throw new Error("Access request was rejected on your Mac.");
        }

        if (current.status === "expired") {
          throw new Error("Access request expired before it was approved.");
        }

        await new Promise((resolve) => setTimeout(resolve, 1_500));
      }

      throw new Error("Access approval timed out.");
    },
    [serverBaseUrl],
  );

  const handleRequestAccess = async () => {
    if (!deviceName.trim()) {
      setStatusMessage("Enter a device name first.");
      return;
    }

    setIsBusy(true);
    try {
      if (!serverBaseUrl.trim()) {
        throw new Error("Enter a server URL first.");
      }

      const pendingRequest = await requestAccess(serverBaseUrl, deviceName);
      setAccessRequest(pendingRequest);
      setStatusMessage("Waiting for approval on your Mac...");
      const bundle = await waitForApproval(pendingRequest.requestId);
      await saveSession(bundle);
      await persistSettings();
      setSessionBundle(bundle);
      setAccessRequest(null);
      setStatusMessage("Paired successfully. Connecting...");
      await connectWithSession(bundle);
    } catch (error) {
      setStatusMessage(toStatusErrorMessage(error));
      setSocketState("error");
    } finally {
      setIsBusy(false);
    }
  };

  const handleConnect = async () => {
    if (socketState === "connecting") {
      return connectPromiseRef.current ?? Promise.resolve();
    }

    if (socketState === "connected" && socketRef.current?.readyState === WebSocket.OPEN) {
      setStatusMessage("Already connected.");
      return;
    }

    if (!sessionBundle) {
      setStatusMessage("Request access first to obtain session credentials.");
      return;
    }

    setIsBusy(true);
    try {
      if (!serverBaseUrl.trim()) {
        throw new Error("Enter a server URL first.");
      }

      const refreshed = await refreshSessionToken(serverBaseUrl, sessionBundle.refreshToken);
      await saveSession(refreshed);
      setSessionBundle(refreshed);
      await persistSettings();
      await connectWithSession(refreshed);
    } catch (error) {
      setStatusMessage(toStatusErrorMessage(error));
      setSocketState("error");
    } finally {
      setIsBusy(false);
    }
  };

  handleConnectRef.current = handleConnect;

  const handleDisconnect = () => {
    connectPromiseRef.current = null;
    socketRef.current?.close();
    socketRef.current = null;
    rejectPendingRequests("Socket disconnected.");
    setSocketState("disconnected");
    setConnectedIdentity("unknown");
    setSessions([]);
    setStatusMessage("Disconnected.");
  };

  const handleForgetSession = async () => {
    await clearSession();
    connectPromiseRef.current = null;
    socketRef.current?.close();
    socketRef.current = null;
    rejectPendingRequests("Session forgotten.");
    setSessionBundle(null);
    setAccessRequest(null);
    setSocketState("disconnected");
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
  }, [hasLoadedPersistedState, isBusy, sessionBundle]);

  useEffect(() => {
    void handleScanServers();
  }, [handleScanServers]);

  return {
    serverBaseUrl,
    deviceName,
    accessRequest,
    sessionBundle,
    socketState,
    statusMessage,
    showAdvancedNetworkSettings,
    lastPushChannel,
    connectedIdentity,
    discoveredServers,
    sessions,
    isRefreshingSessions,
    isScanningServers,
    isSubmittingPrompt,
    formatSessionStatus,
    isBusy,
    setServerBaseUrl,
    setDeviceName,
    setShowAdvancedNetworkSettings,
    handleScanServers,
    handleRequestAccess,
    handleConnect,
    handleDisconnect,
    handleForgetSession,
    handleRefreshSessions: refreshSessions,
    handleStartPrompt,
  } as const;
}

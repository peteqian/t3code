import { useMemo, useState } from "react";
import type { OrchestrationSessionStatus } from "@t3tools/contracts";
import { Button, Card, StatusPill, type StatusTone } from "@t3tools/ui";
import { Menu, Settings } from "lucide-react";
import { toStatusChipColor, useCompanionController } from "./hooks/useCompanionController";

interface SessionCardModel {
  readonly id: string;
  readonly title: string;
  readonly projectTitle: string;
  readonly status: OrchestrationSessionStatus | "inactive";
  readonly providerName: string;
  readonly updatedAt: string;
  readonly lastMessagePreview: string;
  readonly lastError: string | null;
}

function toTopStatusChip(socketState: string): {
  label: string;
  color: StatusTone;
} {
  if (socketState === "connected") return { label: "Connected", color: "success" };
  if (socketState === "connecting") return { label: "Connecting", color: "accent" };
  if (socketState === "error") return { label: "Error", color: "danger" };
  return { label: "Offline", color: "default" };
}

function formatUpdatedAtLabel(updatedAt: string): string {
  const updatedMs = Date.parse(updatedAt);
  if (!Number.isFinite(updatedMs)) return "Updated recently";
  const deltaMs = Math.max(0, Date.now() - updatedMs);
  if (deltaMs < 60000) return "Updated just now";
  if (deltaMs < 3600000) return `Updated ${Math.floor(deltaMs / 60000)}m ago`;
  if (deltaMs < 86400000) return `Updated ${Math.floor(deltaMs / 3600000)}h ago`;
  return `Updated ${Math.floor(deltaMs / 86400000)}d ago`;
}

function toInitials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (parts.length === 0) return "S";
  return parts
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 2);
}

export default function App() {
  const controller = useCompanionController();
  const [showSessionMenu, setShowSessionMenu] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [promptDraft, setPromptDraft] = useState("");

  const recentSessions = useMemo(() => controller.sessions.slice(0, 8), [controller.sessions]);
  const topStatusChip = toTopStatusChip(controller.socketState);

  const handleStartFromComposer = async () => {
    const started = await controller.handleStartPrompt(promptDraft);
    if (started) setPromptDraft("");
  };

  return (
    <div className="app">
      <header className="top-bar">
        <button
          className="icon-button"
          onClick={() => {
            setShowSessionMenu((prev) => !prev);
            setShowSettings(false);
          }}
          aria-label="Open sessions menu"
        >
          <Menu size={20} />
        </button>
        <div className="top-center">
          <h1 className="app-title">T3 Companion</h1>
          <StatusPill tone={topStatusChip.color} label={topStatusChip.label} />
        </div>
        <button
          className="icon-button"
          onClick={() => {
            setShowSettings((prev) => !prev);
            setShowSessionMenu(false);
          }}
          aria-label="Open settings"
        >
          <Settings size={20} />
        </button>
      </header>

      <main className="main-content">
        {showSessionMenu && (
          <SessionMenu
            sessions={controller.sessions}
            formatStatus={controller.formatSessionStatus}
          />
        )}

        {showSettings && (
          <SettingsPanel
            deviceName={controller.deviceName}
            onChangeDeviceName={controller.setDeviceName}
            accessRequest={controller.accessRequest}
            serverBaseUrl={controller.serverBaseUrl}
            onChangeServerBaseUrl={controller.setServerBaseUrl}
            discoveredServers={controller.discoveredServers}
            isScanningServers={controller.isScanningServers}
            onScanServers={() => void controller.handleScanServers()}
            onUseDiscoveredServer={controller.setServerBaseUrl}
            showAdvancedNetworkSettings={controller.showAdvancedNetworkSettings}
            onToggleAdvancedNetworkSettings={() =>
              controller.setShowAdvancedNetworkSettings((prev) => !prev)
            }
            onRequestAccess={() => void controller.handleRequestAccess()}
            onConnect={() => void controller.handleConnect()}
            onDisconnect={controller.handleDisconnect}
            onForgetSession={() => void controller.handleForgetSession()}
            isBusy={controller.isBusy}
            socketState={controller.socketState}
            hasSession={controller.sessionBundle !== null}
          />
        )}

        {controller.statusMessage && (
          <div
            className={`status-banner ${controller.socketState === "error" ? "status-banner-error" : ""}`}
          >
            {controller.statusMessage}
          </div>
        )}

        <Card className="composer-card">
          <textarea
            className="composer-input"
            placeholder="Ask anything to start a new session"
            value={promptDraft}
            onChange={(e) => setPromptDraft(e.target.value)}
            rows={5}
          />
          <div className="composer-actions">
            <Button
              tone="primary"
              onClick={() => void handleStartFromComposer()}
              disabled={controller.isSubmittingPrompt}
            >
              {controller.isSubmittingPrompt ? "Starting..." : "Start session"}
            </Button>
          </div>
        </Card>

        <div className="recent-sessions">
          <div className="section-header">
            <h2>Recent sessions</h2>
            <Button tone="ghost" onClick={() => void controller.handleRefreshSessions()}>
              {controller.isRefreshingSessions ? "Refreshing..." : "Refresh"}
            </Button>
          </div>

          {recentSessions.length === 0 ? (
            <Card>
              <p className="text-muted">
                No recent sessions yet. Pair and connect first to sync from server.
              </p>
            </Card>
          ) : (
            recentSessions.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                statusLabel={controller.formatSessionStatus(session.status)}
              />
            ))
          )}
        </div>
      </main>
    </div>
  );
}

interface SessionMenuProps {
  sessions: readonly SessionCardModel[];
  formatStatus: (status: OrchestrationSessionStatus | "inactive") => string;
}

function SessionMenu({ sessions, formatStatus }: SessionMenuProps) {
  return (
    <Card>
      <h3>All sessions</h3>
      <div className="session-list">
        {sessions.length === 0 ? (
          <p className="text-muted">No sessions synced yet.</p>
        ) : (
          sessions.map((session) => (
            <div key={session.id} className="session-row">
              <div className="session-info">
                <span className="session-title">{session.title}</span>
                <span className="session-project">{session.projectTitle}</span>
              </div>
              <StatusPill
                tone={toStatusChipColor(session.status)}
                label={formatStatus(session.status)}
              />
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

interface SettingsPanelProps {
  deviceName: string;
  onChangeDeviceName: (value: string) => void;
  accessRequest: {
    requestId: string;
    status: "pending" | "approved" | "rejected" | "expired";
    expiresAt: string;
  } | null;
  serverBaseUrl: string;
  onChangeServerBaseUrl: (value: string) => void;
  discoveredServers: readonly { id: string; name: string; baseUrl: string }[];
  isScanningServers: boolean;
  onScanServers: () => void;
  onUseDiscoveredServer: (value: string) => void;
  showAdvancedNetworkSettings: boolean;
  onToggleAdvancedNetworkSettings: () => void;
  onRequestAccess: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onForgetSession: () => void;
  isBusy: boolean;
  socketState: "disconnected" | "connecting" | "connected" | "error";
  hasSession: boolean;
}

function SettingsPanel(props: SettingsPanelProps) {
  const selectedDiscoveredServer = props.discoveredServers.find(
    (server) => server.baseUrl === props.serverBaseUrl,
  );
  const isConnected = props.socketState === "connected";
  const isConnecting = props.socketState === "connecting";

  return (
    <Card className="settings-panel">
      <h3>Connection settings</h3>
      <p className="text-muted">Pair with a nearby server. Manual server URL stays in advanced.</p>

      <div className="form-group">
        <label>Device name</label>
        <input
          type="text"
          value={props.deviceName}
          onChange={(e) => props.onChangeDeviceName(e.target.value)}
          placeholder="Device name"
        />
      </div>

      <div className="form-group">
        <label>Access approval</label>
        <p className="text-muted">Request access here, then approve this device from your Mac.</p>
        <p className="text-muted">
          Active server: {selectedDiscoveredServer?.name ?? props.serverBaseUrl}
        </p>
        {props.accessRequest ? (
          <p className="text-muted">
            Current request: {props.accessRequest.status} until{" "}
            {new Date(props.accessRequest.expiresAt).toLocaleTimeString()}
          </p>
        ) : null}
      </div>

      <div className="form-group">
        <div className="section-header">
          <label>Nearby servers</label>
          <Button
            tone="ghost"
            onClick={props.onScanServers}
            disabled={props.isBusy || isConnecting}
          >
            {props.isScanningServers ? "Scanning..." : "Scan"}
          </Button>
        </div>
        <div className="session-list">
          {props.discoveredServers.length <= 0 ? (
            <p className="text-muted">No nearby servers found yet.</p>
          ) : (
            props.discoveredServers.map((server) => (
              <div key={server.id} className="session-row">
                <div className="session-info">
                  <span className="session-title">{server.name}</span>
                  <span className="session-project">{server.baseUrl}</span>
                </div>
                <Button
                  tone="outline"
                  onClick={() => props.onUseDiscoveredServer(server.baseUrl)}
                  disabled={props.isBusy || isConnecting}
                >
                  {server.baseUrl === props.serverBaseUrl ? "Selected" : "Use"}
                </Button>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="button-row">
        <Button
          tone="primary"
          onClick={props.onRequestAccess}
          disabled={props.isBusy || isConnecting}
        >
          {props.isBusy && !props.hasSession ? "Requesting..." : "Request access"}
        </Button>
        <Button
          tone="secondary"
          onClick={props.onConnect}
          disabled={props.isBusy || isConnecting || isConnected || !props.hasSession}
        >
          {isConnecting ? "Connecting..." : isConnected ? "Connected" : "Connect"}
        </Button>
        <Button
          tone="outline"
          onClick={props.onDisconnect}
          disabled={(!isConnected && !isConnecting) || props.isBusy}
        >
          Disconnect
        </Button>
      </div>

      <Button tone="ghost" onClick={props.onToggleAdvancedNetworkSettings}>
        {props.showAdvancedNetworkSettings ? "Hide advanced" : "Show advanced"}
      </Button>

      {props.showAdvancedNetworkSettings && (
        <div className="advanced-settings">
          <div className="form-group">
            <label>Manual server URL</label>
            <input
              type="text"
              value={props.serverBaseUrl}
              onChange={(e) => props.onChangeServerBaseUrl(e.target.value)}
              placeholder="http://127.0.0.1:3773"
              disabled={props.isBusy || isConnecting}
            />
          </div>
        </div>
      )}

      <Button tone="danger" onClick={props.onForgetSession} disabled={props.isBusy || isConnecting}>
        Forget saved session
      </Button>
    </Card>
  );
}

interface SessionCardProps {
  session: SessionCardModel;
  statusLabel: string;
}

function SessionCard({ session, statusLabel }: SessionCardProps) {
  return (
    <Card className="session-card">
      <div className="session-card-header">
        <div className="session-identity">
          <div className="avatar">{toInitials(session.projectTitle)}</div>
          <div className="session-names">
            <span className="session-title">{session.title}</span>
            <span className="session-project">{session.projectTitle}</span>
          </div>
        </div>
        <StatusPill tone={toStatusChipColor(session.status)} label={statusLabel} />
      </div>
      <p className="session-preview">{session.lastMessagePreview}</p>
      {session.lastError && <p className="error-text">{session.lastError}</p>}
      <div className="session-card-footer">
        <span className="text-muted">{formatUpdatedAtLabel(session.updatedAt)}</span>
        <span className="provider-badge">{session.providerName}</span>
      </div>
    </Card>
  );
}

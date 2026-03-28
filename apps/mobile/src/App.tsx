import { useMemo, useState } from "react";
import type { OrchestrationSessionStatus } from "@t3tools/contracts";
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
  color: "accent" | "success" | "warning" | "danger" | "default";
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
          <span className={`status-chip status-${topStatusChip.color}`}>{topStatusChip.label}</span>
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
            connectionMode={controller.connectionMode}
            onChangeConnectionMode={controller.setConnectionMode}
            deviceName={controller.deviceName}
            onChangeDeviceName={controller.setDeviceName}
            pairingCode={controller.pairingCode}
            onChangePairingCode={controller.setPairingCode}
            localServerBaseUrl={controller.localServerBaseUrl}
            onChangeLocalServerBaseUrl={controller.setLocalServerBaseUrl}
            vpnServerBaseUrl={controller.vpnServerBaseUrl}
            onChangeVpnServerBaseUrl={controller.setVpnServerBaseUrl}
            showAdvancedNetworkSettings={controller.showAdvancedNetworkSettings}
            onToggleAdvancedNetworkSettings={() =>
              controller.setShowAdvancedNetworkSettings((prev) => !prev)
            }
            onPairDevice={() => void controller.handlePairDevice()}
            onConnect={() => void controller.handleConnect()}
            onDisconnect={controller.handleDisconnect}
            onForgetSession={() => void controller.handleForgetSession()}
          />
        )}

        {controller.statusMessage && (
          <div
            className={`status-banner ${controller.socketState === "error" ? "status-banner-error" : ""}`}
          >
            {controller.statusMessage}
          </div>
        )}

        <div className="composer-card">
          <textarea
            className="composer-input"
            placeholder="Ask anything to start a new session"
            value={promptDraft}
            onChange={(e) => setPromptDraft(e.target.value)}
            rows={5}
          />
          <div className="composer-actions">
            <button
              className="button button-primary"
              onClick={() => void handleStartFromComposer()}
              disabled={controller.isSubmittingPrompt}
            >
              {controller.isSubmittingPrompt ? "Starting..." : "Start session"}
            </button>
          </div>
        </div>

        <div className="recent-sessions">
          <div className="section-header">
            <h2>Recent sessions</h2>
            <button
              className="button button-ghost"
              onClick={() => void controller.handleRefreshSessions()}
            >
              {controller.isRefreshingSessions ? "Refreshing..." : "Refresh"}
            </button>
          </div>

          {recentSessions.length === 0 ? (
            <div className="card">
              <p className="text-muted">
                No recent sessions yet. Pair and connect first to sync from server.
              </p>
            </div>
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
    <div className="card">
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
              <span className={`status-chip status-${toStatusChipColor(session.status)}`}>
                {formatStatus(session.status)}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

interface SettingsPanelProps {
  connectionMode: string;
  onChangeConnectionMode: (mode: "auto" | "local" | "vpn") => void;
  deviceName: string;
  onChangeDeviceName: (value: string) => void;
  pairingCode: string;
  onChangePairingCode: (value: string) => void;
  localServerBaseUrl: string;
  onChangeLocalServerBaseUrl: (value: string) => void;
  vpnServerBaseUrl: string;
  onChangeVpnServerBaseUrl: (value: string) => void;
  showAdvancedNetworkSettings: boolean;
  onToggleAdvancedNetworkSettings: () => void;
  onPairDevice: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onForgetSession: () => void;
}

function SettingsPanel(props: SettingsPanelProps) {
  return (
    <div className="card settings-panel">
      <h3>Connection settings</h3>
      <p className="text-muted">Configure pairing and network preferences.</p>

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
        <label>Pairing code</label>
        <input
          type="text"
          value={props.pairingCode}
          onChange={(e) => props.onChangePairingCode(e.target.value)}
          placeholder="Pairing code"
        />
      </div>

      <div className="button-row">
        <button className="button button-primary" onClick={props.onPairDevice}>
          Pair device
        </button>
        <button className="button button-secondary" onClick={props.onConnect}>
          Connect
        </button>
        <button className="button button-outline" onClick={props.onDisconnect}>
          Disconnect
        </button>
      </div>

      <button className="button button-ghost" onClick={props.onToggleAdvancedNetworkSettings}>
        {props.showAdvancedNetworkSettings ? "Hide advanced" : "Show advanced"}
      </button>

      {props.showAdvancedNetworkSettings && (
        <div className="advanced-settings">
          <div className="button-row">
            {(["auto", "local", "vpn"] as const).map((mode) => (
              <button
                key={mode}
                className={`button ${props.connectionMode === mode ? "button-primary" : "button-outline"}`}
                onClick={() => props.onChangeConnectionMode(mode)}
              >
                {mode.toUpperCase()}
              </button>
            ))}
          </div>
          <div className="form-group">
            <label>Local URL</label>
            <input
              type="text"
              value={props.localServerBaseUrl}
              onChange={(e) => props.onChangeLocalServerBaseUrl(e.target.value)}
              placeholder="http://127.0.0.1:3773"
            />
          </div>
          <div className="form-group">
            <label>VPN URL</label>
            <input
              type="text"
              value={props.vpnServerBaseUrl}
              onChange={(e) => props.onChangeVpnServerBaseUrl(e.target.value)}
              placeholder="http://your-host.ts.net:3773"
            />
          </div>
        </div>
      )}

      <button className="button button-danger" onClick={props.onForgetSession}>
        Forget saved session
      </button>
    </div>
  );
}

interface SessionCardProps {
  session: SessionCardModel;
  statusLabel: string;
}

function SessionCard({ session, statusLabel }: SessionCardProps) {
  return (
    <div className="card session-card">
      <div className="session-card-header">
        <div className="session-identity">
          <div className="avatar">{toInitials(session.projectTitle)}</div>
          <div className="session-names">
            <span className="session-title">{session.title}</span>
            <span className="session-project">{session.projectTitle}</span>
          </div>
        </div>
        <span className={`status-chip status-${toStatusChipColor(session.status)}`}>
          {statusLabel}
        </span>
      </div>
      <p className="session-preview">{session.lastMessagePreview}</p>
      {session.lastError && <p className="error-text">{session.lastError}</p>}
      <div className="session-card-footer">
        <span className="text-muted">{formatUpdatedAtLabel(session.updatedAt)}</span>
        <span className="provider-badge">{session.providerName}</span>
      </div>
    </div>
  );
}

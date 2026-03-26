import { HeroUINativeProvider } from "heroui-native/provider";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import {
  ActivityIndicator,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import "./global.css";
import {
  type MobileConnectionMode,
  type MobileConnectionTarget,
  type MobileSessionBundle,
} from "./mobilePairing";
import { useCompanionController } from "./useCompanionController";

const heroUiConfig = {
  devInfo: {
    stylingPrinciples: false,
  },
} as const;

/**
 * Renders the mobile companion app pairing and connection screen.
 */
export default function App() {
  const controller = useCompanionController();

  return (
    <GestureHandlerRootView style={styles.root}>
      <HeroUINativeProvider config={heroUiConfig}>
        <SafeAreaProvider>
          <SafeAreaView style={styles.safeArea}>
            <View style={styles.container}>
              <Text style={styles.kicker}>T3 Code Companion</Text>
              <Text style={styles.title}>Session Pairing</Text>
              <Text style={styles.body}>
                In iOS Simulator, generate a code in desktop/web settings, then paste it here.
              </Text>

              <TextInput
                style={styles.input}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="Device name"
                value={controller.deviceName}
                onChangeText={controller.setDeviceName}
              />
              <TextInput
                style={styles.input}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="Pairing code"
                value={controller.pairingCode}
                onChangeText={controller.setPairingCode}
              />

              <View style={styles.row}>
                <ActionButton
                  label="Pair Device"
                  onPress={() => void controller.handlePairDevice()}
                />
              </View>

              <Pressable
                style={styles.advancedToggleButton}
                onPress={() => controller.setShowAdvancedNetworkSettings((existing) => !existing)}
              >
                <Text style={styles.advancedToggleLabel}>
                  {controller.showAdvancedNetworkSettings
                    ? "Hide advanced network settings"
                    : "Show advanced network settings"}
                </Text>
              </Pressable>

              {controller.showAdvancedNetworkSettings ? (
                <View style={styles.advancedCard}>
                  <ConnectionModeSelector
                    connectionMode={controller.connectionMode}
                    onChange={controller.setConnectionMode}
                  />
                  <TextInput
                    style={styles.input}
                    autoCapitalize="none"
                    autoCorrect={false}
                    placeholder="Local URL (e.g. http://127.0.0.1:3773)"
                    value={controller.localServerBaseUrl}
                    onChangeText={controller.setLocalServerBaseUrl}
                  />
                  <TextInput
                    style={styles.input}
                    autoCapitalize="none"
                    autoCorrect={false}
                    placeholder="VPN URL (e.g. http://your-host.ts.net:3773)"
                    value={controller.vpnServerBaseUrl}
                    onChangeText={controller.setVpnServerBaseUrl}
                  />
                </View>
              ) : null}

              <View style={styles.row}>
                <ActionButton label="Connect" onPress={() => void controller.handleConnect()} />
                <ActionButton label="Disconnect" onPress={controller.handleDisconnect} />
                <ActionButton
                  label="Forget"
                  onPress={() => void controller.handleForgetSession()}
                />
              </View>

              <ConnectionMetaCard
                socketState={controller.socketState}
                activeEndpointTarget={controller.activeEndpointTarget}
                sessionBundle={controller.sessionBundle}
                connectedIdentity={controller.connectedIdentity}
                lastPushChannel={controller.lastPushChannel}
              />

              <Text style={styles.status}>{controller.statusMessage}</Text>
              {controller.isBusy ? <ActivityIndicator size="small" color="#0f172a" /> : null}
              <StatusBar barStyle="dark-content" />
            </View>
          </SafeAreaView>
        </SafeAreaProvider>
      </HeroUINativeProvider>
    </GestureHandlerRootView>
  );
}

interface ActionButtonProps {
  readonly label: string;
  readonly onPress: () => void;
}

interface ConnectionModeSelectorProps {
  readonly connectionMode: MobileConnectionMode;
  readonly onChange: (mode: MobileConnectionMode) => void;
}

interface ConnectionMetaCardProps {
  readonly socketState: string;
  readonly activeEndpointTarget: MobileConnectionTarget | null;
  readonly sessionBundle: MobileSessionBundle | null;
  readonly connectedIdentity: string;
  readonly lastPushChannel: string | null;
}

/**
 * Renders a compact action button.
 */
function ActionButton(props: ActionButtonProps) {
  return (
    <Pressable style={styles.button} onPress={props.onPress}>
      <Text style={styles.buttonLabel}>{props.label}</Text>
    </Pressable>
  );
}

/**
 * Renders the network preference control.
 */
function ConnectionModeSelector(props: ConnectionModeSelectorProps) {
  const modeLabels: Record<MobileConnectionMode, string> = {
    auto: "Auto",
    local: "Local",
    vpn: "VPN",
  };

  return (
    <>
      <Text style={styles.modeLabel}>Network preference</Text>
      <View style={styles.modeRow}>
        {(["auto", "local", "vpn"] as const).map((mode) => {
          const active = props.connectionMode === mode;
          return (
            <Pressable
              key={mode}
              style={[styles.modeButton, active ? styles.modeButtonActive : null]}
              onPress={() => props.onChange(mode)}
            >
              <Text style={[styles.modeButtonLabel, active ? styles.modeButtonLabelActive : null]}>
                {modeLabels[mode]}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </>
  );
}

/**
 * Displays companion connectivity diagnostics.
 */
function ConnectionMetaCard(props: ConnectionMetaCardProps) {
  const networkLabel =
    props.activeEndpointTarget === "vpn"
      ? "VPN"
      : props.activeEndpointTarget === "local"
        ? "Local"
        : "Not connected";

  return (
    <View style={styles.metaCard}>
      <Text style={styles.metaLine}>Socket: {props.socketState}</Text>
      <Text style={styles.metaLine}>Network: {networkLabel}</Text>
      <Text style={styles.metaLine}>
        Session: {props.sessionBundle ? `${props.sessionBundle.deviceId.slice(0, 8)}...` : "none"}
      </Text>
      <Text style={styles.metaLine}>Identity: {props.connectedIdentity}</Text>
      <Text style={styles.metaLine}>Last push: {props.lastPushChannel ?? "(waiting)"}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    backgroundColor: "#f6f7fb",
  },
  container: {
    flex: 1,
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 24,
  },
  kicker: {
    color: "#0369a1",
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  title: {
    color: "#0f172a",
    fontSize: 28,
    fontWeight: "700",
  },
  body: {
    color: "#334155",
    fontSize: 14,
    lineHeight: 20,
  },
  input: {
    borderColor: "#cbd5e1",
    borderRadius: 12,
    borderWidth: 1,
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  advancedToggleButton: {
    alignSelf: "flex-start",
  },
  advancedToggleLabel: {
    color: "#0f172a",
    fontSize: 12,
    fontWeight: "600",
    textDecorationLine: "underline",
  },
  advancedCard: {
    borderColor: "#cbd5e1",
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
    padding: 12,
  },
  modeLabel: {
    color: "#334155",
    fontSize: 13,
    fontWeight: "600",
  },
  modeRow: {
    flexDirection: "row",
    gap: 8,
  },
  modeButton: {
    borderColor: "#cbd5e1",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  modeButtonActive: {
    backgroundColor: "#0f172a",
    borderColor: "#0f172a",
  },
  modeButtonLabel: {
    color: "#334155",
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
  },
  modeButtonLabelActive: {
    color: "#f8fafc",
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  button: {
    backgroundColor: "#0f172a",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  buttonLabel: {
    color: "#f8fafc",
    fontSize: 13,
    fontWeight: "600",
  },
  metaCard: {
    backgroundColor: "#e2e8f0",
    borderRadius: 12,
    gap: 4,
    padding: 12,
  },
  metaLine: {
    color: "#0f172a",
    fontSize: 12,
    fontWeight: "500",
  },
  status: {
    color: "#0f172a",
    fontSize: 13,
  },
});

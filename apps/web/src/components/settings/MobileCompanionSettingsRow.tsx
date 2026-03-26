import { type MobilePairingCreateResponse } from "@t3tools/contracts";
import { useCallback, useEffect, useState } from "react";

import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { cn } from "../../lib/utils";
import { ensureNativeApi } from "../../nativeApi";
import { onServerMobilePresence } from "../../wsNativeApi";
import { SettingsRow } from "./SettingsPrimitives";
import { Button } from "../ui/button";

interface MobileDeviceSummary {
  readonly deviceId: string;
  readonly deviceName: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

function toMobileSettingsErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) {
    return fallback;
  }
  if (
    error.message.includes("server.listMobileDevices") ||
    error.message.includes("server.revokeMobileDevice")
  ) {
    return "Mobile device management requires a server restart.";
  }
  return error.message;
}

/**
 * Renders and manages mobile pairing, presence, and paired-device controls.
 */
export function MobileCompanionSettingsRow() {
  const [mobilePairing, setMobilePairing] = useState<MobilePairingCreateResponse | null>(null);
  const [isCreatingMobilePairing, setIsCreatingMobilePairing] = useState(false);
  const [mobilePairingError, setMobilePairingError] = useState<string | null>(null);
  const [connectedDeviceLabel, setConnectedDeviceLabel] = useState<string>("None");
  const [isMobileConnected, setIsMobileConnected] = useState(false);
  const [onlineDeviceIds, setOnlineDeviceIds] = useState<ReadonlySet<string>>(new Set());
  const [mobileDevices, setMobileDevices] = useState<ReadonlyArray<MobileDeviceSummary>>([]);
  const [isLoadingMobileDevices, setIsLoadingMobileDevices] = useState(false);
  const [revokingDeviceId, setRevokingDeviceId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const { copyToClipboard, isCopied } = useCopyToClipboard<void>({
    onError: () => {
      setMobilePairingError("Clipboard unavailable in this environment.");
    },
  });

  const mobilePairingExpiresAtMs = mobilePairing ? Date.parse(mobilePairing.expiresAt) : null;
  const mobilePairingSecondsRemaining =
    mobilePairingExpiresAtMs === null
      ? null
      : Math.max(0, Math.ceil((mobilePairingExpiresAtMs - nowMs) / 1000));
  const mobilePairingExpired =
    mobilePairingSecondsRemaining !== null && mobilePairingSecondsRemaining <= 0;

  useEffect(() => {
    const interval = globalThis.setInterval(() => {
      setNowMs(Date.now());
    }, 1_000);
    return () => {
      globalThis.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    return onServerMobilePresence((payload) => {
      setOnlineDeviceIds(new Set(payload.deviceIds));
      if (payload.mobileConnectionCount <= 0) {
        setIsMobileConnected(false);
        setConnectedDeviceLabel("None");
        return;
      }
      setIsMobileConnected(true);
      if (payload.deviceNames.length <= 0) {
        setConnectedDeviceLabel("Mobile device");
        return;
      }
      const firstDevice = payload.deviceNames[0] ?? "Mobile device";
      const extraCount = Math.max(0, payload.deviceNames.length - 1);
      setConnectedDeviceLabel(extraCount > 0 ? `${firstDevice} +${extraCount}` : firstDevice);
    });
  }, []);

  const loadMobileDevices = useCallback(async () => {
    setIsLoadingMobileDevices(true);
    setMobilePairingError(null);
    try {
      const api = ensureNativeApi();
      const result = await api.server.listMobileDevices();
      setMobileDevices(result.devices);
    } catch (error) {
      setMobilePairingError(
        toMobileSettingsErrorMessage(error, "Unable to load paired mobile devices."),
      );
    } finally {
      setIsLoadingMobileDevices(false);
    }
  }, []);

  const revokeMobileDevice = useCallback(
    async (deviceId: string) => {
      setRevokingDeviceId(deviceId);
      setMobilePairingError(null);
      try {
        const api = ensureNativeApi();
        await api.server.revokeMobileDevice({ deviceId });
        await loadMobileDevices();
      } catch (error) {
        setMobilePairingError(
          toMobileSettingsErrorMessage(error, "Unable to revoke mobile device."),
        );
      } finally {
        setRevokingDeviceId(null);
      }
    },
    [loadMobileDevices],
  );

  useEffect(() => {
    void loadMobileDevices();
  }, [loadMobileDevices]);

  const createMobilePairingCode = useCallback(async () => {
    setIsCreatingMobilePairing(true);
    setMobilePairingError(null);
    try {
      const api = ensureNativeApi();
      const pairing = await api.server.createMobilePairing({ ttlSeconds: 120 });
      setMobilePairing(pairing);
    } catch (error) {
      setMobilePairingError(
        error instanceof Error ? error.message : "Unable to create mobile pairing code.",
      );
    } finally {
      setIsCreatingMobilePairing(false);
    }
  }, []);

  return (
    <SettingsRow
      title="Mobile companion"
      description="Generate a short pairing code to link the mobile app without sharing server auth tokens."
      control={
        <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
          {mobilePairing ? (
            <Button
              size="xs"
              variant="outline"
              onClick={() => {
                copyToClipboard(mobilePairing.pairingCode, undefined);
              }}
            >
              {isCopied ? "Copied" : "Copy code"}
            </Button>
          ) : null}
          <Button
            size="xs"
            variant="outline"
            disabled={isLoadingMobileDevices}
            onClick={() => void loadMobileDevices()}
          >
            {isLoadingMobileDevices ? "Refreshing..." : "Refresh devices"}
          </Button>
          <Button
            size="xs"
            variant="outline"
            disabled={isCreatingMobilePairing}
            onClick={() => void createMobilePairingCode()}
          >
            {isCreatingMobilePairing
              ? "Generating..."
              : mobilePairing
                ? "Regenerate"
                : "Generate code"}
          </Button>
        </div>
      }
    >
      <div className="mt-4 space-y-2 border-t border-border pt-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              isMobileConnected ? "bg-emerald-500" : "bg-red-500",
            )}
          />
          <span>Connected device: {connectedDeviceLabel}</span>
        </div>
        {mobilePairing ? (
          <>
            <div className="inline-flex rounded-md border border-border bg-muted px-3 py-2 font-mono text-sm tracking-[0.16em] text-foreground">
              {mobilePairing.pairingCode}
            </div>
            <p className="text-xs text-muted-foreground">
              {mobilePairingExpired
                ? "Code expired. Generate a new one."
                : `Code expires in ${mobilePairingSecondsRemaining ?? 0}s.`}
            </p>
          </>
        ) : null}
        <div className="space-y-2 pt-2">
          {mobileDevices.length <= 0 ? (
            <p className="text-xs text-muted-foreground">No paired devices yet.</p>
          ) : (
            mobileDevices.map((device) => {
              const isOnline = onlineDeviceIds.has(device.deviceId);
              return (
                <div
                  key={device.deviceId}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
                >
                  <div className="min-w-0 text-xs">
                    <p className="truncate font-medium text-foreground">{device.deviceName}</p>
                    <p className="text-muted-foreground">
                      Last seen {new Date(device.updatedAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "h-2 w-2 rounded-full",
                        isOnline ? "bg-emerald-500" : "bg-red-500",
                      )}
                    />
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={revokingDeviceId === device.deviceId}
                      onClick={() => void revokeMobileDevice(device.deviceId)}
                    >
                      {revokingDeviceId === device.deviceId ? "Revoking..." : "Revoke"}
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>
        {mobilePairingError ? (
          <p className="text-xs text-destructive">{mobilePairingError}</p>
        ) : null}
      </div>
    </SettingsRow>
  );
}

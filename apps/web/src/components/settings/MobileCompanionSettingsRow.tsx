import { useCallback, useEffect, useState } from "react";

import type { MobileDeviceSummary } from "@t3tools/contracts";

import {
  useMobileAccessRequests,
  toMobileAccessErrorMessage,
} from "../../hooks/useMobileAccessRequests";
import { cn } from "../../lib/utils";
import { ensureNativeApi } from "../../nativeApi";
import { onServerMobilePresence } from "../../wsNativeApi";
import { Button } from "../ui/button";
import { SettingsRow } from "./SettingsPrimitives";

export function MobileCompanionSettingsRow() {
  const [connectedDeviceLabel, setConnectedDeviceLabel] = useState<string>("None");
  const [isMobileConnected, setIsMobileConnected] = useState(false);
  const [onlineDeviceIds, setOnlineDeviceIds] = useState<ReadonlySet<string>>(new Set());
  const [mobileDevices, setMobileDevices] = useState<ReadonlyArray<MobileDeviceSummary>>([]);
  const [mobileDevicesError, setMobileDevicesError] = useState<string | null>(null);
  const [isRefreshingDevices, setIsRefreshingDevices] = useState(false);
  const [revokingDeviceId, setRevokingDeviceId] = useState<string | null>(null);
  const {
    pendingRequests,
    isRefreshing,
    mobileAccessError,
    approveRequestId,
    rejectRequestId,
    refreshRequests,
    approveRequest,
    rejectRequest,
  } = useMobileAccessRequests();

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
    setIsRefreshingDevices(true);
    setMobileDevicesError(null);

    try {
      const api = ensureNativeApi();
      const result = await api.server.listMobileDevices();
      setMobileDevices(result.devices);
    } catch (error) {
      setMobileDevicesError(
        toMobileAccessErrorMessage(error, "Unable to load paired mobile devices."),
      );
    } finally {
      setIsRefreshingDevices(false);
    }
  }, []);

  const revokeMobileDevice = useCallback(
    async (deviceId: string) => {
      setRevokingDeviceId(deviceId);
      setMobileDevicesError(null);

      try {
        const api = ensureNativeApi();
        await api.server.revokeMobileDevice({ deviceId });
        await loadMobileDevices();
      } catch (error) {
        setMobileDevicesError(toMobileAccessErrorMessage(error, "Unable to revoke mobile device."));
      } finally {
        setRevokingDeviceId(null);
      }
    },
    [loadMobileDevices],
  );

  const refreshMobileState = useCallback(async () => {
    await Promise.all([refreshRequests(), loadMobileDevices()]);
  }, [loadMobileDevices, refreshRequests]);

  useEffect(() => {
    void loadMobileDevices();
  }, [loadMobileDevices]);

  return (
    <SettingsRow
      title="Mobile companion"
      description="Approve nearby mobile devices from your Mac, then let them reconnect with saved tokens."
      control={
        <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
          <Button
            size="xs"
            variant="outline"
            disabled={isRefreshing || isRefreshingDevices}
            onClick={() => void refreshMobileState()}
          >
            {isRefreshing || isRefreshingDevices ? "Refreshing..." : "Refresh"}
          </Button>
        </div>
      }
    >
      <div className="mt-4 space-y-3 border-t border-border pt-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              isMobileConnected ? "bg-emerald-500" : "bg-red-500",
            )}
          />
          <span>Connected device: {connectedDeviceLabel}</span>
        </div>

        <div className="space-y-2">
          <h4 className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Pending approval
          </h4>
          {pendingRequests.length <= 0 ? (
            <p className="text-xs text-muted-foreground">No pending mobile access requests.</p>
          ) : (
            pendingRequests.map((request) => (
              <div
                key={request.requestId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
              >
                <div className="min-w-0 text-xs">
                  <p className="truncate font-medium text-foreground">{request.deviceName}</p>
                  <p className="text-muted-foreground">
                    Expires {new Date(request.expiresAt).toLocaleTimeString()}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={approveRequestId === request.requestId}
                    onClick={() => void approveRequest(request.requestId)}
                  >
                    {approveRequestId === request.requestId ? "Approving..." : "Approve"}
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={rejectRequestId === request.requestId}
                    onClick={() => void rejectRequest(request.requestId)}
                  >
                    {rejectRequestId === request.requestId ? "Rejecting..." : "Reject"}
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="space-y-2 pt-2">
          <h4 className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Paired devices
          </h4>
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

        {mobileAccessError ? <p className="text-xs text-destructive">{mobileAccessError}</p> : null}
        {mobileDevicesError ? (
          <p className="text-xs text-destructive">{mobileDevicesError}</p>
        ) : null}
      </div>
    </SettingsRow>
  );
}

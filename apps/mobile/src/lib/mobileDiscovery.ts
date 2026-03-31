import { Capacitor, registerPlugin } from "@capacitor/core";
import type { MobileDiscoveredServer, MobileDiscoveryScanResponse } from "@t3tools/contracts";

interface MobileDiscoveryPlugin {
  scan(options?: { readonly timeoutMs?: number }): Promise<MobileDiscoveryScanResponse>;
}

const mobileDiscoveryPlugin = registerPlugin<MobileDiscoveryPlugin>("MobileDiscovery");

function isPluginUnavailable(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes("not implemented") ||
    error.message.includes("UNIMPLEMENTED") ||
    error.message.includes("plugin is not implemented")
  );
}

export async function scanServers(
  timeoutMs = 1200,
): Promise<ReadonlyArray<MobileDiscoveredServer>> {
  if (!Capacitor.isNativePlatform()) {
    return [];
  }

  try {
    const result = await mobileDiscoveryPlugin.scan({ timeoutMs });
    return result.servers;
  } catch (error) {
    if (isPluginUnavailable(error)) {
      return [];
    }

    throw error;
  }
}

import { basename } from "node:path";
import { type NetworkInterfaceInfo } from "node:os";
import {
  MOBILE_DISCOVERY_PROTOCOL_VERSION,
  MOBILE_DISCOVERY_REQUEST_KIND,
  MOBILE_DISCOVERY_RESPONSE_KIND,
  type MobileDiscoveryRequest,
  type MobileDiscoveryResponse,
} from "@t3tools/contracts";

interface DiscoveryConfig {
  readonly cwd: string;
  readonly host: string | undefined;
  readonly publicHost: string | undefined;
  readonly port: number;
}

type NetworkMap = NodeJS.Dict<NetworkInterfaceInfo[]>;

function trimHost(host: string | undefined): string | undefined {
  const value = host?.trim();
  if (!value) {
    return undefined;
  }
  return value;
}

export function isWildcardHost(host: string | undefined): boolean {
  return host === "0.0.0.0" || host === "::" || host === "[::]";
}

export function isLoopbackHost(host: string | undefined): boolean {
  if (!host) {
    return false;
  }
  return host === "127.0.0.1" || host === "::1" || host === "[::1]" || host === "localhost";
}

function getIpv4Hosts(networks: NetworkMap): string[] {
  const hosts: string[] = [];

  for (const entries of Object.values(networks)) {
    for (const entry of entries ?? []) {
      if (entry.internal || entry.family !== "IPv4") {
        continue;
      }

      hosts.push(entry.address);
    }
  }

  return hosts;
}

function sameSubnet(left: string, right: string): boolean {
  const leftParts = left.split(".");
  const rightParts = right.split(".");
  if (leftParts.length !== 4 || rightParts.length !== 4) {
    return false;
  }

  return (
    leftParts[0] === rightParts[0] &&
    leftParts[1] === rightParts[1] &&
    leftParts[2] === rightParts[2]
  );
}

export function pickDiscoveryHost(
  config: Pick<DiscoveryConfig, "host" | "publicHost">,
  requestAddress: string,
  networks: NetworkMap,
): string | null {
  const publicHost = trimHost(config.publicHost);
  if (publicHost) {
    return publicHost;
  }

  const host = trimHost(config.host);
  if (host && !isWildcardHost(host) && !isLoopbackHost(host)) {
    return host;
  }

  const ipv4Hosts = getIpv4Hosts(networks);
  if (ipv4Hosts.length <= 0) {
    return null;
  }

  const sameSubnetHost = ipv4Hosts.find((candidate) => sameSubnet(candidate, requestAddress));
  if (sameSubnetHost) {
    return sameSubnetHost;
  }

  return ipv4Hosts[0] ?? null;
}

export function shouldStartMobileDiscovery(
  config: Pick<DiscoveryConfig, "host" | "publicHost">,
): boolean {
  const publicHost = trimHost(config.publicHost);
  if (publicHost) {
    return true;
  }

  const host = trimHost(config.host);
  if (!host) {
    return true;
  }

  return !isLoopbackHost(host);
}

export function parseDiscoveryRequest(raw: string): MobileDiscoveryRequest | null {
  try {
    const parsed = JSON.parse(raw) as Partial<MobileDiscoveryRequest>;
    if (
      parsed.kind !== MOBILE_DISCOVERY_REQUEST_KIND ||
      parsed.version !== MOBILE_DISCOVERY_PROTOCOL_VERSION
    ) {
      return null;
    }

    return {
      kind: MOBILE_DISCOVERY_REQUEST_KIND,
      version: MOBILE_DISCOVERY_PROTOCOL_VERSION,
    };
  } catch {
    return null;
  }
}

export function createDiscoveryResponse(
  config: DiscoveryConfig,
  requestAddress: string,
  hostname: string,
  networks: NetworkMap,
): MobileDiscoveryResponse | null {
  const host = pickDiscoveryHost(config, requestAddress, networks);
  if (!host) {
    return null;
  }

  const projectName = basename(config.cwd) || hostname;

  return {
    kind: MOBILE_DISCOVERY_RESPONSE_KIND,
    version: MOBILE_DISCOVERY_PROTOCOL_VERSION,
    server: {
      id: `${hostname}:${config.port}`,
      name: `${hostname} (${projectName})`,
      host,
      port: config.port,
      baseUrl: `http://${host}:${config.port}`,
    },
  };
}

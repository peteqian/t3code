import { Schema } from "effect";
import { NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas";

export const MOBILE_DISCOVERY_REQUEST_KIND = "t3-mobile-discovery";
export const MOBILE_DISCOVERY_RESPONSE_KIND = "t3-mobile-discovery-response";
export const MOBILE_DISCOVERY_PROTOCOL_VERSION = 1;
export const MOBILE_DISCOVERY_PORT = 37731;

export const MobileDiscoveryRequest = Schema.Struct({
  kind: Schema.Literal(MOBILE_DISCOVERY_REQUEST_KIND),
  version: Schema.Literal(MOBILE_DISCOVERY_PROTOCOL_VERSION),
});
export type MobileDiscoveryRequest = typeof MobileDiscoveryRequest.Type;

export const MobileDiscoveredServer = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  host: TrimmedNonEmptyString,
  port: NonNegativeInt,
  baseUrl: TrimmedNonEmptyString,
});
export type MobileDiscoveredServer = typeof MobileDiscoveredServer.Type;

export const MobileDiscoveryResponse = Schema.Struct({
  kind: Schema.Literal(MOBILE_DISCOVERY_RESPONSE_KIND),
  version: Schema.Literal(MOBILE_DISCOVERY_PROTOCOL_VERSION),
  server: MobileDiscoveredServer,
});
export type MobileDiscoveryResponse = typeof MobileDiscoveryResponse.Type;

export const MobileDiscoveryScanResponse = Schema.Struct({
  servers: Schema.Array(MobileDiscoveredServer),
});
export type MobileDiscoveryScanResponse = typeof MobileDiscoveryScanResponse.Type;

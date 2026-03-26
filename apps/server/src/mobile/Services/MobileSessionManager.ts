import type {
  MobileListDevicesResponse,
  MobilePairingCreateResponse,
  MobilePairingExchangeRequest,
  MobilePairingExchangeResponse,
  MobileRevokeDeviceResponse,
  MobileTokenRefreshRequest,
  MobileTokenRefreshResponse,
} from "@t3tools/contracts";
import { Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

export class MobileSessionError extends Schema.TaggedErrorClass<MobileSessionError>()(
  "MobileSessionError",
  {
    message: Schema.String,
  },
) {}

export interface MobileSessionManagerShape {
  readonly createPairingSecret: (input?: {
    readonly ttlSeconds?: number;
  }) => Effect.Effect<MobilePairingCreateResponse>;
  readonly exchangePairingSecret: (
    input: MobilePairingExchangeRequest,
  ) => Effect.Effect<MobilePairingExchangeResponse, MobileSessionError>;
  readonly refreshAccessToken: (
    input: MobileTokenRefreshRequest,
  ) => Effect.Effect<MobileTokenRefreshResponse, MobileSessionError>;
  readonly validateAccessToken: (
    accessToken: string,
  ) => Effect.Effect<{ readonly deviceId: string; readonly deviceName: string } | null>;
  readonly listDevices: () => Effect.Effect<MobileListDevicesResponse>;
  readonly revokeDevice: (
    deviceId: string,
  ) => Effect.Effect<MobileRevokeDeviceResponse, MobileSessionError>;
}

export class MobileSessionManager extends ServiceMap.Service<
  MobileSessionManager,
  MobileSessionManagerShape
>()("t3/mobile/Services/MobileSessionManager") {}

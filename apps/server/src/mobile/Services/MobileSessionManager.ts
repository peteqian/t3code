import type {
  MobileAccessRequestCreateRequest,
  MobileAccessRequestCreateResponse,
  MobileAccessStatusRequest,
  MobileAccessStatusResponse,
  MobileApproveAccessRequestResponse,
  MobileListAccessRequestsResponse,
  MobileListDevicesResponse,
  MobileRejectAccessRequestResponse,
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
  readonly createAccessRequest: (
    input: MobileAccessRequestCreateRequest,
  ) => Effect.Effect<MobileAccessRequestCreateResponse>;
  readonly getAccessRequestStatus: (
    input: MobileAccessStatusRequest,
  ) => Effect.Effect<MobileAccessStatusResponse>;
  readonly listAccessRequests: () => Effect.Effect<MobileListAccessRequestsResponse>;
  readonly approveAccessRequest: (
    requestId: string,
  ) => Effect.Effect<MobileApproveAccessRequestResponse, MobileSessionError>;
  readonly rejectAccessRequest: (
    requestId: string,
  ) => Effect.Effect<MobileRejectAccessRequestResponse, MobileSessionError>;
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

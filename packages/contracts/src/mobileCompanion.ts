import { Schema } from "effect";
import { IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas";

export const MobileTokenBundle = Schema.Struct({
  deviceId: TrimmedNonEmptyString,
  accessToken: TrimmedNonEmptyString,
  accessTokenExpiresAt: IsoDateTime,
  refreshToken: TrimmedNonEmptyString,
});
export type MobileTokenBundle = typeof MobileTokenBundle.Type;

export const MobileAccessRequestCreateRequest = Schema.Struct({
  deviceName: TrimmedNonEmptyString,
  ttlSeconds: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 30, maximum: 300 }))),
});
export type MobileAccessRequestCreateRequest = typeof MobileAccessRequestCreateRequest.Type;

export const MobileAccessRequestCreateResponse = Schema.Struct({
  requestId: TrimmedNonEmptyString,
  status: Schema.Literal("pending"),
  createdAt: IsoDateTime,
  expiresAt: IsoDateTime,
});
export type MobileAccessRequestCreateResponse = typeof MobileAccessRequestCreateResponse.Type;

export const MobileAccessStatusRequest = Schema.Struct({
  requestId: TrimmedNonEmptyString,
});
export type MobileAccessStatusRequest = typeof MobileAccessStatusRequest.Type;

export const MobilePendingAccessRequest = Schema.Struct({
  requestId: TrimmedNonEmptyString,
  deviceName: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
  expiresAt: IsoDateTime,
});
export type MobilePendingAccessRequest = typeof MobilePendingAccessRequest.Type;

export const MobileListAccessRequestsResponse = Schema.Struct({
  requests: Schema.Array(MobilePendingAccessRequest),
});
export type MobileListAccessRequestsResponse = typeof MobileListAccessRequestsResponse.Type;

export const MobileApproveAccessRequestRequest = Schema.Struct({
  requestId: TrimmedNonEmptyString,
});
export type MobileApproveAccessRequestRequest = typeof MobileApproveAccessRequestRequest.Type;

export const MobileApproveAccessRequestResponse = Schema.Struct({
  approved: Schema.Boolean,
});
export type MobileApproveAccessRequestResponse = typeof MobileApproveAccessRequestResponse.Type;

export const MobileRejectAccessRequestRequest = Schema.Struct({
  requestId: TrimmedNonEmptyString,
});
export type MobileRejectAccessRequestRequest = typeof MobileRejectAccessRequestRequest.Type;

export const MobileRejectAccessRequestResponse = Schema.Struct({
  rejected: Schema.Boolean,
});
export type MobileRejectAccessRequestResponse = typeof MobileRejectAccessRequestResponse.Type;

export const MobileAccessStatusResponse = Schema.Struct({
  status: Schema.Literals(["pending", "approved", "rejected", "expired"]),
  expiresAt: IsoDateTime,
  session: Schema.optional(MobileTokenBundle),
});
export type MobileAccessStatusResponse = typeof MobileAccessStatusResponse.Type;

export const MobileTokenRefreshRequest = Schema.Struct({
  refreshToken: TrimmedNonEmptyString,
});
export type MobileTokenRefreshRequest = typeof MobileTokenRefreshRequest.Type;

export const MobileTokenRefreshResponse = MobileTokenBundle;
export type MobileTokenRefreshResponse = typeof MobileTokenRefreshResponse.Type;

export const MobileDeviceSummary = Schema.Struct({
  deviceId: TrimmedNonEmptyString,
  deviceName: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type MobileDeviceSummary = typeof MobileDeviceSummary.Type;

export const MobileListDevicesResponse = Schema.Struct({
  devices: Schema.Array(MobileDeviceSummary),
});
export type MobileListDevicesResponse = typeof MobileListDevicesResponse.Type;

export const MobileRevokeDeviceRequest = Schema.Struct({
  deviceId: TrimmedNonEmptyString,
});
export type MobileRevokeDeviceRequest = typeof MobileRevokeDeviceRequest.Type;

export const MobileRevokeDeviceResponse = Schema.Struct({
  revoked: Schema.Boolean,
});
export type MobileRevokeDeviceResponse = typeof MobileRevokeDeviceResponse.Type;

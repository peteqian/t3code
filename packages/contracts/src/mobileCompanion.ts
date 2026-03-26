import { Schema } from "effect";
import { IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas";

export const MobilePairingCreateRequest = Schema.Struct({
  ttlSeconds: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 30, maximum: 300 }))),
});
export type MobilePairingCreateRequest = typeof MobilePairingCreateRequest.Type;

export const MobilePairingCreateResponse = Schema.Struct({
  pairingCode: TrimmedNonEmptyString,
  expiresAt: IsoDateTime,
});
export type MobilePairingCreateResponse = typeof MobilePairingCreateResponse.Type;

export const MobilePairingExchangeRequest = Schema.Struct({
  pairingCode: TrimmedNonEmptyString,
  deviceName: TrimmedNonEmptyString,
});
export type MobilePairingExchangeRequest = typeof MobilePairingExchangeRequest.Type;

export const MobileTokenBundle = Schema.Struct({
  deviceId: TrimmedNonEmptyString,
  accessToken: TrimmedNonEmptyString,
  accessTokenExpiresAt: IsoDateTime,
  refreshToken: TrimmedNonEmptyString,
});
export type MobileTokenBundle = typeof MobileTokenBundle.Type;

export const MobilePairingExchangeResponse = MobileTokenBundle;
export type MobilePairingExchangeResponse = typeof MobilePairingExchangeResponse.Type;

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

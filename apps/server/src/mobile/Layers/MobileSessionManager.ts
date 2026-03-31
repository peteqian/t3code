import { randomUUID, createHash, randomBytes } from "node:crypto";

import type {
  MobileAccessRequestCreateResponse,
  MobileAccessStatusResponse,
  MobileTokenBundle,
  MobileTokenRefreshResponse,
} from "@t3tools/contracts";
import { Effect, FileSystem, Layer, Path, Ref } from "effect";

import { ServerConfig } from "../../config";
import {
  MobileSessionError,
  MobileSessionManager,
  type MobileSessionManagerShape,
} from "../Services/MobileSessionManager";

interface AccessTokenRecord {
  readonly deviceId: string;
  readonly expiresAtMs: number;
}

interface PersistedDeviceRecord {
  readonly id: string;
  readonly deviceName: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly refreshTokenHash: string;
}

interface PendingAccessRequestRecord {
  readonly requestId: string;
  readonly deviceName: string;
  readonly createdAt: string;
  readonly expiresAtMs: number;
  readonly status: "pending" | "approved" | "rejected";
  readonly session: MobileTokenBundle | null;
}

interface MobileSessionState {
  readonly accessRequestsById: Map<string, PendingAccessRequestRecord>;
  readonly accessTokens: Map<string, AccessTokenRecord>;
  readonly devicesById: Map<string, PersistedDeviceRecord>;
  readonly deviceIdByRefreshTokenHash: Map<string, string>;
}

interface PersistedState {
  readonly devices: ReadonlyArray<PersistedDeviceRecord>;
}

const DEFAULT_ACCESS_REQUEST_TTL_SECONDS = 120;
const ACCESS_TOKEN_TTL_MS = 5 * 60 * 1000;

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function createToken(): string {
  return randomBytes(24).toString("base64url");
}

function toIsoDateTime(valueMs: number): string {
  return new Date(valueMs).toISOString();
}

function createSessionBundle(input: {
  readonly deviceId: string;
  readonly accessToken: string;
  readonly accessTokenExpiresAtMs: number;
  readonly refreshToken: string;
}): MobileTokenBundle {
  return {
    deviceId: input.deviceId,
    accessToken: input.accessToken,
    accessTokenExpiresAt: toIsoDateTime(input.accessTokenExpiresAtMs),
    refreshToken: input.refreshToken,
  };
}

const loadPersistedState = Effect.fn(function* (sessionsFilePath: string) {
  const fs = yield* FileSystem.FileSystem;
  const raw = yield* fs
    .readFileString(sessionsFilePath)
    .pipe(Effect.catch(() => Effect.succeed("")));
  if (raw.trim().length <= 0) {
    return { devices: [] } satisfies PersistedState;
  }

  const parsed = yield* Effect.try({
    try: () => JSON.parse(raw) as Partial<PersistedState>,
    catch: () => ({ devices: [] }) satisfies PersistedState,
  });

  return {
    devices: Array.isArray(parsed.devices)
      ? parsed.devices.filter(
          (device): device is PersistedDeviceRecord =>
            Boolean(device) &&
            typeof device.id === "string" &&
            typeof device.deviceName === "string" &&
            typeof device.createdAt === "string" &&
            typeof device.updatedAt === "string" &&
            typeof device.refreshTokenHash === "string",
        )
      : [],
  } satisfies PersistedState;
});

const persistState = Effect.fn(function* (
  sessionsFilePath: string,
  devicesById: Map<string, PersistedDeviceRecord>,
) {
  const fs = yield* FileSystem.FileSystem;
  const payload: PersistedState = {
    devices: Array.from(devicesById.values()),
  };
  yield* fs.writeFileString(sessionsFilePath, JSON.stringify(payload, null, 2));
});

function pruneAccessRequests(
  accessRequestsById: Map<string, PendingAccessRequestRecord>,
  now: number,
): void {
  for (const [requestId, request] of accessRequestsById.entries()) {
    if (request.expiresAtMs <= now) {
      accessRequestsById.delete(requestId);
    }
  }
}

export const MobileSessionManagerLive = Layer.effect(
  MobileSessionManager,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const serverConfig = yield* ServerConfig;
    const sessionsFilePath = path.join(serverConfig.stateDir, "mobile-sessions.json");
    const persisted = yield* loadPersistedState(sessionsFilePath).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
    );

    const state = yield* Ref.make<MobileSessionState>({
      accessRequestsById: new Map(),
      accessTokens: new Map(),
      devicesById: new Map(persisted.devices.map((device) => [device.id, device])),
      deviceIdByRefreshTokenHash: new Map(
        persisted.devices.map((device) => [device.refreshTokenHash, device.id]),
      ),
    });

    const persistDevices = (devicesById: Map<string, PersistedDeviceRecord>) =>
      persistState(sessionsFilePath, devicesById).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.mapError(
          () =>
            new MobileSessionError({
              message: "Failed to persist paired device session state.",
            }),
        ),
      );

    const createAccessRequest: MobileSessionManagerShape["createAccessRequest"] = (input) =>
      Ref.modify(state, (current) => {
        const now = Date.now();
        pruneAccessRequests(current.accessRequestsById, now);

        const ttlSeconds = Math.max(
          30,
          Math.min(300, input.ttlSeconds ?? DEFAULT_ACCESS_REQUEST_TTL_SECONDS),
        );
        const requestId = randomUUID();
        const createdAt = new Date(now).toISOString();
        const expiresAtMs = now + ttlSeconds * 1000;
        current.accessRequestsById.set(requestId, {
          requestId,
          deviceName: input.deviceName,
          createdAt,
          expiresAtMs,
          status: "pending",
          session: null,
        });

        return [
          {
            requestId,
            status: "pending",
            createdAt,
            expiresAt: toIsoDateTime(expiresAtMs),
          } satisfies MobileAccessRequestCreateResponse,
          current,
        ] as const;
      });

    const getAccessRequestStatus: MobileSessionManagerShape["getAccessRequestStatus"] = (input) =>
      Ref.modify(state, (current): readonly [MobileAccessStatusResponse, MobileSessionState] => {
        const now = Date.now();
        pruneAccessRequests(current.accessRequestsById, now);

        const request = current.accessRequestsById.get(input.requestId);
        if (!request) {
          return [
            {
              status: "expired",
              expiresAt: new Date(now).toISOString(),
            } satisfies MobileAccessStatusResponse,
            current,
          ] as const;
        }

        return [
          {
            status: request.status,
            expiresAt: toIsoDateTime(request.expiresAtMs),
            session: request.session ?? undefined,
          } satisfies MobileAccessStatusResponse,
          current,
        ] as const;
      });

    const listAccessRequests: MobileSessionManagerShape["listAccessRequests"] = () =>
      Ref.modify(state, (current) => {
        const now = Date.now();
        pruneAccessRequests(current.accessRequestsById, now);

        return [
          {
            requests: Array.from(current.accessRequestsById.values())
              .filter((request) => request.status === "pending")
              .map((request) => ({
                requestId: request.requestId,
                deviceName: request.deviceName,
                createdAt: request.createdAt,
                expiresAt: toIsoDateTime(request.expiresAtMs),
              }))
              .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt)),
          },
          current,
        ] as const;
      });

    const approveAccessRequest: MobileSessionManagerShape["approveAccessRequest"] = (requestId) =>
      Effect.gen(function* () {
        const now = Date.now();
        const approved = yield* Ref.modify(state, (current) => {
          pruneAccessRequests(current.accessRequestsById, now);

          const request = current.accessRequestsById.get(requestId);
          if (!request || request.status !== "pending") {
            return [false, current] as const;
          }

          const deviceId = randomUUID();
          const refreshToken = createToken();
          const refreshTokenHash = hashSecret(refreshToken);
          const accessToken = createToken();
          const accessTokenExpiresAtMs = now + ACCESS_TOKEN_TTL_MS;
          const nowIso = new Date(now).toISOString();

          current.devicesById.set(deviceId, {
            id: deviceId,
            deviceName: request.deviceName,
            createdAt: nowIso,
            updatedAt: nowIso,
            refreshTokenHash,
          });
          current.deviceIdByRefreshTokenHash.set(refreshTokenHash, deviceId);
          current.accessTokens.set(accessToken, {
            deviceId,
            expiresAtMs: accessTokenExpiresAtMs,
          });
          current.accessRequestsById.set(requestId, {
            ...request,
            status: "approved",
            session: createSessionBundle({
              deviceId,
              accessToken,
              accessTokenExpiresAtMs,
              refreshToken,
            }),
          });

          return [true, current] as const;
        });

        if (!approved) {
          return yield* new MobileSessionError({
            message: "Access request is missing or already handled.",
          });
        }

        const current = yield* Ref.get(state);
        yield* persistDevices(current.devicesById);
        return { approved: true };
      });

    const rejectAccessRequest: MobileSessionManagerShape["rejectAccessRequest"] = (requestId) =>
      Ref.modify(state, (current) => {
        const now = Date.now();
        pruneAccessRequests(current.accessRequestsById, now);

        const request = current.accessRequestsById.get(requestId);
        if (!request || request.status !== "pending") {
          return [false, current] as const;
        }

        current.accessRequestsById.set(requestId, {
          ...request,
          status: "rejected",
        });
        return [true, current] as const;
      }).pipe(Effect.map((rejected) => ({ rejected })));

    const refreshAccessToken: MobileSessionManagerShape["refreshAccessToken"] = (input) =>
      Effect.gen(function* () {
        const refreshTokenHash = hashSecret(input.refreshToken);
        const now = Date.now();

        const refreshed = yield* Ref.modify(state, (current) => {
          const deviceId = current.deviceIdByRefreshTokenHash.get(refreshTokenHash);
          if (!deviceId) {
            return [null as MobileTokenRefreshResponse | null, current] as const;
          }

          const device = current.devicesById.get(deviceId);
          if (!device) {
            current.deviceIdByRefreshTokenHash.delete(refreshTokenHash);
            return [null as MobileTokenRefreshResponse | null, current] as const;
          }

          const rotatedRefreshToken = createToken();
          const rotatedRefreshTokenHash = hashSecret(rotatedRefreshToken);
          const accessToken = createToken();
          const accessTokenExpiresAtMs = now + ACCESS_TOKEN_TTL_MS;
          current.devicesById.set(device.id, {
            ...device,
            updatedAt: new Date(now).toISOString(),
            refreshTokenHash: rotatedRefreshTokenHash,
          });
          current.deviceIdByRefreshTokenHash.delete(refreshTokenHash);
          current.deviceIdByRefreshTokenHash.set(rotatedRefreshTokenHash, device.id);
          current.accessTokens.set(accessToken, {
            deviceId: device.id,
            expiresAtMs: accessTokenExpiresAtMs,
          });

          return [
            createSessionBundle({
              deviceId: device.id,
              accessToken,
              accessTokenExpiresAtMs,
              refreshToken: rotatedRefreshToken,
            }),
            current,
          ] as const;
        });

        if (!refreshed) {
          return yield* new MobileSessionError({
            message: "Refresh token is invalid.",
          });
        }

        const current = yield* Ref.get(state);
        yield* persistDevices(current.devicesById);
        return refreshed;
      });

    const validateAccessToken: MobileSessionManagerShape["validateAccessToken"] = (accessToken) =>
      Ref.modify(state, (current) => {
        const token = current.accessTokens.get(accessToken);
        if (!token) {
          return [null, current] as const;
        }

        const now = Date.now();
        if (token.expiresAtMs <= now) {
          current.accessTokens.delete(accessToken);
          return [null, current] as const;
        }

        const device = current.devicesById.get(token.deviceId);
        if (!device) {
          current.accessTokens.delete(accessToken);
          return [null, current] as const;
        }

        return [{ deviceId: token.deviceId, deviceName: device.deviceName }, current] as const;
      });

    const listDevices: MobileSessionManagerShape["listDevices"] = () =>
      Ref.get(state).pipe(
        Effect.map((current) => ({
          devices: Array.from(current.devicesById.values())
            .map((device) => ({
              deviceId: device.id,
              deviceName: device.deviceName,
              createdAt: device.createdAt,
              updatedAt: device.updatedAt,
            }))
            .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
        })),
      );

    const revokeDevice: MobileSessionManagerShape["revokeDevice"] = (deviceId) =>
      Effect.gen(function* () {
        const revoked = yield* Ref.modify(state, (current) => {
          if (!current.devicesById.has(deviceId)) {
            return [false, current] as const;
          }

          const revokedRefreshTokenHashes = Array.from(current.deviceIdByRefreshTokenHash.entries())
            .filter(([, candidateDeviceId]) => candidateDeviceId === deviceId)
            .map(([refreshTokenHash]) => refreshTokenHash);
          for (const refreshTokenHash of revokedRefreshTokenHashes) {
            current.deviceIdByRefreshTokenHash.delete(refreshTokenHash);
          }
          current.devicesById.delete(deviceId);
          for (const [token, tokenRecord] of current.accessTokens.entries()) {
            if (tokenRecord.deviceId === deviceId) {
              current.accessTokens.delete(token);
            }
          }

          return [true, current] as const;
        });

        if (revoked) {
          const current = yield* Ref.get(state);
          yield* persistDevices(current.devicesById);
        }

        return { revoked };
      });

    return {
      createAccessRequest,
      getAccessRequestStatus,
      listAccessRequests,
      approveAccessRequest,
      rejectAccessRequest,
      refreshAccessToken,
      validateAccessToken,
      listDevices,
      revokeDevice,
    } satisfies MobileSessionManagerShape;
  }),
);

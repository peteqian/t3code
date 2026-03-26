import { createHash, randomBytes, randomUUID } from "node:crypto";

import type {
  MobilePairingCreateResponse,
  MobilePairingExchangeResponse,
  MobileTokenRefreshResponse,
} from "@t3tools/contracts";
import { Effect, FileSystem, Layer, Path, Ref } from "effect";

import { ServerConfig } from "../../config";
import {
  MobileSessionError,
  MobileSessionManager,
  type MobileSessionManagerShape,
} from "../Services/MobileSessionManager";

interface PairingSecretRecord {
  readonly expiresAtMs: number;
}

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

interface MobileSessionState {
  readonly pairingSecretsByHash: Map<string, PairingSecretRecord>;
  readonly accessTokens: Map<string, AccessTokenRecord>;
  readonly devicesById: Map<string, PersistedDeviceRecord>;
  readonly deviceIdByRefreshTokenHash: Map<string, string>;
}

interface PersistedState {
  readonly devices: ReadonlyArray<PersistedDeviceRecord>;
}

const DEFAULT_PAIRING_TTL_SECONDS = 120;
const ACCESS_TOKEN_TTL_MS = 5 * 60 * 1000;
const PAIRING_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PAIRING_CODE_LENGTH = 8;

/**
 * Hashes a secret token for at-rest storage and lookups.
 */
function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/**
 * Creates a random token suitable for URL/query transport.
 */
function createToken(): string {
  return randomBytes(24).toString("base64url");
}

function normalizePairingCode(pairingCode: string): string {
  return pairingCode.trim().toUpperCase();
}

function createPairingCode(): string {
  const bytes = randomBytes(PAIRING_CODE_LENGTH);
  let code = "";
  for (let index = 0; index < PAIRING_CODE_LENGTH; index += 1) {
    code += PAIRING_CODE_ALPHABET[bytes[index]! % PAIRING_CODE_ALPHABET.length];
  }
  return code;
}

/**
 * Creates an ISO expiration timestamp from milliseconds.
 */
function toIsoDateTime(expiresAtMs: number): string {
  return new Date(expiresAtMs).toISOString();
}

/**
 * Creates the token response payload consumed by mobile clients.
 */
function createTokenResponse(input: {
  readonly deviceId: string;
  readonly accessToken: string;
  readonly accessTokenExpiresAtMs: number;
  readonly refreshToken: string;
}): MobilePairingExchangeResponse {
  return {
    deviceId: input.deviceId,
    accessToken: input.accessToken,
    accessTokenExpiresAt: toIsoDateTime(input.accessTokenExpiresAtMs),
    refreshToken: input.refreshToken,
  };
}

/**
 * Reads persisted mobile device records from disk.
 */
const loadPersistedState = Effect.fn(function* (sessionsFilePath: string) {
  const fs = yield* FileSystem.FileSystem;
  const raw = yield* fs
    .readFileString(sessionsFilePath)
    .pipe(Effect.catch(() => Effect.succeed("")));
  if (raw.trim().length === 0) {
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

/**
 * Persists mobile device records to disk.
 */
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
      pairingSecretsByHash: new Map(),
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

    const createPairingSecret: MobileSessionManagerShape["createPairingSecret"] = (input) =>
      Ref.modify(state, (current) => {
        const ttlSeconds = Math.max(
          30,
          Math.min(300, input?.ttlSeconds ?? DEFAULT_PAIRING_TTL_SECONDS),
        );
        const pairingCode = createPairingCode();
        const pairingCodeHash = hashSecret(normalizePairingCode(pairingCode));
        const expiresAtMs = Date.now() + ttlSeconds * 1000;
        current.pairingSecretsByHash.set(pairingCodeHash, { expiresAtMs });
        return [
          {
            pairingCode,
            expiresAt: toIsoDateTime(expiresAtMs),
          } satisfies MobilePairingCreateResponse,
          current,
        ] as const;
      });

    const exchangePairingSecret: MobileSessionManagerShape["exchangePairingSecret"] = (input) =>
      Effect.gen(function* () {
        const pairingCodeHash = hashSecret(normalizePairingCode(input.pairingCode));
        const now = Date.now();

        const result = yield* Ref.modify(state, (current) => {
          const pairingRecord = current.pairingSecretsByHash.get(pairingCodeHash);
          if (!pairingRecord || pairingRecord.expiresAtMs <= now) {
            current.pairingSecretsByHash.delete(pairingCodeHash);
            return [null as MobilePairingExchangeResponse | null, current] as const;
          }

          current.pairingSecretsByHash.delete(pairingCodeHash);

          const deviceId = randomUUID();
          const refreshToken = createToken();
          const refreshTokenHash = hashSecret(refreshToken);
          const accessToken = createToken();
          const accessTokenExpiresAtMs = now + ACCESS_TOKEN_TTL_MS;
          const nowIso = new Date(now).toISOString();

          current.devicesById.set(deviceId, {
            id: deviceId,
            deviceName: input.deviceName,
            createdAt: nowIso,
            updatedAt: nowIso,
            refreshTokenHash,
          });
          current.deviceIdByRefreshTokenHash.set(refreshTokenHash, deviceId);
          current.accessTokens.set(accessToken, {
            deviceId,
            expiresAtMs: accessTokenExpiresAtMs,
          });

          return [
            createTokenResponse({
              deviceId,
              accessToken,
              accessTokenExpiresAtMs,
              refreshToken,
            }),
            current,
          ] as const;
        });

        if (!result) {
          return yield* new MobileSessionError({
            message: "Pairing code is invalid or expired.",
          });
        }

        const current = yield* Ref.get(state);
        yield* persistDevices(current.devicesById);
        return result;
      });

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
            createTokenResponse({
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

        if (!current.devicesById.has(token.deviceId)) {
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
      createPairingSecret,
      exchangePairingSecret,
      refreshAccessToken,
      validateAccessToken,
      listDevices,
      revokeDevice,
    } satisfies MobileSessionManagerShape;
  }),
);

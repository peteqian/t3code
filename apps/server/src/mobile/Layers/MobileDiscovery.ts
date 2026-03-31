import dgram from "node:dgram";
import os from "node:os";
import { Effect, Layer } from "effect";
import { MOBILE_DISCOVERY_PORT } from "@t3tools/contracts";

import { ServerConfig } from "../../config";
import {
  createDiscoveryResponse,
  parseDiscoveryRequest,
  shouldStartMobileDiscovery,
} from "../discoveryProtocol";
import {
  MobileDiscovery,
  MobileDiscoveryError,
  type MobileDiscoveryShape,
} from "../Services/MobileDiscovery";

export const MobileDiscoveryLive = Layer.effect(
  MobileDiscovery,
  Effect.gen(function* () {
    const config = yield* ServerConfig;

    const start: MobileDiscoveryShape["start"] = !shouldStartMobileDiscovery(config)
      ? Effect.void
      : Effect.acquireRelease(
          Effect.tryPromise({
            try: () =>
              new Promise<dgram.Socket>((resolve, reject) => {
                const socket = dgram.createSocket("udp4");

                socket.on("message", (message, remote) => {
                  const request = parseDiscoveryRequest(message.toString("utf8"));
                  if (!request) {
                    return;
                  }

                  const response = createDiscoveryResponse(
                    {
                      cwd: config.cwd,
                      host: config.host,
                      publicHost: config.publicHost,
                      port: config.port,
                    },
                    remote.address,
                    os.hostname(),
                    os.networkInterfaces(),
                  );
                  if (!response) {
                    return;
                  }

                  const payload = Buffer.from(JSON.stringify(response), "utf8");
                  socket.send(payload, remote.port, remote.address);
                });

                socket.once("error", (cause) => {
                  reject(cause);
                });

                socket.bind(MOBILE_DISCOVERY_PORT, () => {
                  resolve(socket);
                });
              }),
            catch: (cause) =>
              new MobileDiscoveryError({
                message:
                  cause instanceof Error
                    ? `Failed to start mobile discovery responder: ${cause.message}`
                    : "Failed to start mobile discovery responder.",
              }),
          }),
          (socket) =>
            Effect.sync(() => {
              socket.removeAllListeners("message");
              socket.close();
            }),
        ).pipe(
          Effect.asVoid,
          Effect.catch((error) =>
            Effect.logWarning("mobile discovery disabled", {
              message: error.message,
            }),
          ),
        );

    return {
      start,
    } satisfies MobileDiscoveryShape;
  }),
);

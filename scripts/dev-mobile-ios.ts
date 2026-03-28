#!/usr/bin/env node

import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import path from "node:path";

const mobileDir = path.resolve(process.cwd(), "apps/mobile");
const port = Number.parseInt(process.env.CAP_LIVE_RELOAD_PORT ?? "4300", 10);
const host = process.env.CAP_LIVE_RELOAD_HOST ?? "localhost";

let devProcess: ChildProcess | undefined;
let iosProcess: ChildProcess | undefined;
let shuttingDown = false;

/**
 * Wait until a TCP port accepts connections.
 */
function waitForPort(portToCheck: number, timeoutMs: number): Promise<void> {
  const start = Date.now();

  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const socket = net.createConnection({ host: "127.0.0.1", port: portToCheck });

      socket.once("connect", () => {
        socket.end();
        resolve();
      });

      socket.once("error", () => {
        socket.destroy();
        if (Date.now() - start >= timeoutMs) {
          reject(new Error(`Timed out waiting for dev server on port ${portToCheck}`));
          return;
        }
        setTimeout(tryConnect, 300);
      });
    };

    tryConnect();
  });
}

/**
 * Stop child processes and exit once they are terminated.
 */
function shutdown(exitCode = 0): void {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  if (iosProcess && !iosProcess.killed) {
    iosProcess.kill("SIGTERM");
  }

  if (devProcess && !devProcess.killed) {
    devProcess.kill("SIGTERM");
  }

  setTimeout(() => process.exit(exitCode), 150);
}

/**
 * Launch mobile Vite dev server and Capacitor iOS live reload runner.
 */
async function main(): Promise<void> {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid CAP_LIVE_RELOAD_PORT: ${String(process.env.CAP_LIVE_RELOAD_PORT)}`);
  }

  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));

  devProcess = spawn("bun", ["run", "dev", "--host", "--port", String(port)], {
    cwd: mobileDir,
    stdio: "inherit",
    env: process.env,
  });

  devProcess.once("exit", (code) => {
    if (!shuttingDown) {
      shutdown(code ?? 1);
    }
  });

  await waitForPort(port, 30_000);

  iosProcess = spawn("bunx", ["cap", "run", "ios", "-l", "--host", host, "--port", String(port)], {
    cwd: mobileDir,
    stdio: "inherit",
    env: process.env,
  });

  iosProcess.once("exit", (code) => {
    shutdown(code ?? 0);
  });
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  shutdown(1);
});

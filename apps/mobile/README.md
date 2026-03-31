# T3 Companion (Mobile)

Capacitor-based mobile app that connects to the T3 Code server.

## Quick Start

```bash
# Development with live reload (recommended)
bun run dev:mobile:ios

# Or separate steps:
bun run dev:mobile      # Start Vite dev server only
npx cap open ios         # Open in Xcode, then run from there
```

## Build & Sync

```bash
bun run build            # Build web app
npx cap sync ios         # Sync to iOS
npx cap open ios         # Open in Xcode
```

For Android:

```bash
npx cap sync android
npx cap open android
```

## Live Reload

`dev:mobile:ios` starts a Vite dev server on port 4300 (configurable via `CAP_LIVE_RELOAD_PORT`) and runs Capacitor with `--live-reload`. Changes to web code reload automatically.

To configure the reload host, set `CAP_LIVE_RELOAD_HOST`:

```bash
CAP_LIVE_RELOAD_HOST=192.168.1.x bun run dev:mobile:ios
```

## Connecting to Server

The intended direction is discovery-first:

1. Mobile should find nearby T3 Code servers automatically
2. Pair against the selected server
3. Only use a manual server URL as an advanced fallback

Until discovery lands, the advanced fallback is a single manual server URL.

On mobile devices, `localhost` refers to the device itself, not your Mac.

For browser-based mobile testing against the repo dev server, prefer starting the stack with a real client-facing host:

```bash
bun run dev:lan -- --public-host=192.168.x.x
```

Use your Mac's LAN IP for `--public-host`, or a VPN hostname/IP if you're connecting over a VPN.

Manual server URL examples:

- iOS Simulator: `http://192.168.x.x:3773`
- Android Emulator: `http://10.0.2.2:3773`
- Real device on WiFi: `http://192.168.x.x:3773`

Find your Mac's IP with: `ifconfig | grep "inet " | grep 192.168`

## Troubleshooting

- **Cannot connect**: Ensure server is running (`bun run dev:server`) and you're using the correct server URL (not `127.0.0.1` or `localhost` on a real device)
- **Sync issues**: Run `npx cap sync ios` after any native plugin changes
- **Clean rebuild**: `npx cap open ios` → Product → Clean Build Folder in Xcode

# Mobile Companion (3-Step Plan)

## Why this order

Yes, mobile-first is the right execution order. We should stand up the Expo app first so we can validate UX and transport assumptions early, then layer persistent pairing/auth, then polish and ship.

## Step 1

Build `apps/mobile` with Expo + HeroUI Native and a minimal companion shell.

## Step 2

Hook mobile to desktop/server over Tailscale with persistent pairing and token refresh.

## Step 3

Harden security, add device management UX, and run rollout validation.

## Definition of done

- Mobile app installs and launches on iOS/Android simulators/devices.
- Mobile reconnects to desktop without re-pairing after desktop restarts.
- Auth applies consistently to both WebSocket and HTTP private endpoints.

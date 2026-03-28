# Step 2 - Persistent Tailscale Connection and Pairing

## Goal

Enable stable companion connectivity so mobile can reconnect without manual re-pairing after desktop restarts.

## Scope

1. Implement mobile WebSocket transport compatible with existing contracts:
   - request/response envelopes
   - push channel subscriptions
   - reconnect backoff
2. Add orchestration-first API coverage:
   - `getSnapshot`
   - `dispatchCommand`
   - `onDomainEvent`
3. Implement persistent pairing protocol:
   - one-time pairing secret (QR/manual)
   - mobile device registration
   - short-lived access token + refresh token
4. Add desktop companion manager:
   - issue/rotate mobile tokens
   - track paired devices
   - survive backend restarts
5. Harden server auth in companion mode:
   - preserve WS token auth
   - apply token checks to private HTTP routes as well

## Outputs

- Mobile re-establishes sessions automatically after desktop restart.
- Pairing is one-time unless revoked.
- Unauthorized HTTP and WS access is blocked when companion auth is enabled.

## Verify

- `bun fmt`
- `bun lint`
- `bun typecheck`
- focused tests for auth + reconnect behavior

## Current Status

- Session-based pairing, token refresh, mobile WS auth, device presence, and revoke flows are implemented.
- Desktop/web pairing generation exists and mobile no longer requires direct server auth token entry.

## Deferred TODOs

1. Desktop "Pair Mobile" polish:
   - move pairing UX to a primary surface (chat header/sidebar)
   - improve pairing affordances and completion confirmation
2. Security tightening:
   - max paired-device policy
   - inactivity expiry / stale-device pruning
   - stronger audit-style auth/device action logging

## Next Step (Active)

Implement Tailscale network path selection and fallback:

1. Add connection target model in mobile settings:
   - local URL
   - tailnet URL
   - auto mode with deterministic preference order
2. Add connect strategy:
   - try preferred endpoint first
   - fallback to alternate endpoint with bounded retries/backoff
   - expose which endpoint is active in UI
3. Persist endpoint preference and last known good endpoint.
4. Add focused tests for target selection and fallback behavior.

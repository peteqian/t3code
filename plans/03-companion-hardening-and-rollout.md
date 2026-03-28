# Step 3 - Companion Hardening and Rollout

## Goal

Ship a reliable companion experience with clear operator controls and low support burden.

## Scope

1. Device management UX:
   - list paired devices
   - revoke one device
   - revoke all devices
2. Security hardening:
   - pairing rate limiting
   - replay protection
   - token rotation windows and expiry policy
3. Reliability hardening:
   - explicit offline states
   - reconnect diagnostics
   - graceful degraded modes when desktop/tailnet is unavailable
4. Docs and runbooks:
   - companion setup flow
   - Tailscale prerequisites
   - troubleshooting matrix
5. Rollout:
   - feature flag for internal alpha
   - telemetry on connect success/reconnect latency/auth failures

## Outputs

- Secure and supportable persistent companion feature.
- Actionable diagnostics for users and maintainers.
- Rollout checklist with measurable success criteria.

## Verify

- `bun fmt`
- `bun lint`
- `bun typecheck`
- scenario tests (restart, revoke, token expiry, tailnet disconnect)

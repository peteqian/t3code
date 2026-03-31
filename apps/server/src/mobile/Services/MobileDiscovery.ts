import { Schema, Scope, ServiceMap } from "effect";
import type { Effect } from "effect";

export class MobileDiscoveryError extends Schema.TaggedErrorClass<MobileDiscoveryError>()(
  "MobileDiscoveryError",
  {
    message: Schema.String,
  },
) {}

export interface MobileDiscoveryShape {
  readonly start: Effect.Effect<void, never, Scope.Scope>;
}

export class MobileDiscovery extends ServiceMap.Service<MobileDiscovery, MobileDiscoveryShape>()(
  "t3/mobile/Services/MobileDiscovery",
) {}

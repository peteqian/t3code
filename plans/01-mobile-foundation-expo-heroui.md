# Step 1 - Mobile Foundation (Expo + HeroUI Native)

## Goal

Get a working `apps/mobile` app in the monorepo quickly so we can iterate on real screens and transport behavior.

## Scope

1. Create `apps/mobile` as an Expo-managed app (`@t3tools/mobile`).
2. Install HeroUI Native and required peer dependencies (exact versions from docs).
3. Configure Uniwind and `global.css` imports for HeroUI Native styles.
4. Wrap app root with `GestureHandlerRootView` and `HeroUINativeProvider`.
5. Use granular imports (`heroui-native/provider`, `heroui-native/button`, etc.).
6. Add baseline screens:
   - Pairing setup screen
   - Connection status screen
   - Minimal timeline/chat placeholder screen
7. Add local config model for endpoint/token input during early dev.

## Outputs

- `apps/mobile` compiles and runs in Expo on iOS/Android.
- HeroUI Native components render correctly.
- Baseline app navigation and state shell are in place.

## Verify

- `bun fmt`
- `bun lint`
- `bun typecheck`

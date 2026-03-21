---
description: Testing patterns and conventions
globs: ["**/*.test.ts", "**/*.spec.ts", "**/vitest.config.ts"]
---

# Testing Rules

## Framework

- **Vitest** with `globals: true` (no need to import `describe`, `it`, `expect`)
- Environment: `node`
- Test files: `*.test.ts` or `*.spec.ts` colocated with source files or in `__tests__/` directories
- Both vitest configs have `watch: false` and `passWithNoTests: true`

## Server Test Strategy

Since the MCP server communicates with REAPER via file-based IPC, tests should:

1. **Mock `sendCommand()`** from `bridge.ts` to return canned `BridgeResponse` objects
2. Test that tools correctly validate parameters (zod schemas)
3. Test that tools correctly format responses (success and error cases)
4. Test bridge utility functions (`isBridgeRunning`, `cleanupStaleFiles`, `getBridgeDir`)

Do NOT try to start an actual REAPER instance in tests.

## Protocol Test Strategy

- Test type exports and ensure interfaces match expected shapes
- These are mainly compile-time checks -- if the build passes, types are correct

## Running Tests

```bash
pnpm nx test reaper-mcp-server    # Test server
pnpm nx test protocol             # Test protocol
pnpm nx run-many --target=test    # Test all
```

## Vitest Config Locations

- `apps/reaper-mcp-server/vitest.config.ts` -- has `@reaper-mcp/protocol` alias for path resolution
- `libs/protocol/vitest.config.ts` -- minimal config

---
description: Development workflow and coding standards
paths: ["**/*.ts", "**/*.json"]
---

# Development Rules

## Build & Test

- Always use `pnpm` (not npm or yarn) -- this is a pnpm workspace
- Always use `pnpm nx <target> <project>` to run targets, not raw tool commands
- Build order matters: `protocol` must build before `reaper-mcp-server` (Nx handles this via `dependsOn: ["^build"]`)
- Run `pnpm nx run-many --target=build,lint,test` to validate everything before committing

## TypeScript

- ESM modules throughout (`"type": "module"` in package.json, `"module": "esnext"` in tsconfig)
- Use `.js` extensions in imports even for TypeScript files (ESM requires this)
- Path alias `@reaper-mcp/protocol` resolves to `libs/protocol/src/index.ts`
- Strict mode is enabled -- no `any` types, no implicit returns, etc.
- Target ES2022 / Node 20

## Adding MCP Tools

Every new tool requires changes in 4 places (always update all 4):

1. `libs/protocol/src/commands.ts` -- Add to `CommandType` union + params interface
2. `libs/protocol/src/responses.ts` -- Add response data interface if needed
3. `apps/reaper-mcp-server/src/tools/<file>.ts` -- Implement tool with `server.tool()` + zod schema
4. `reaper/mcp_bridge.lua` -- Add handler to the `handlers` table

If you miss any of these, the tool will either not compile, not be registered, or silently fail at runtime.

## Tool Implementation Pattern

Tools follow this exact pattern:
- Use `zod` for parameter validation in the `server.tool()` call
- Call `sendCommand()` from `bridge.ts` with the command type and params
- Check `response.success` and return error content if false
- Return `JSON.stringify(response.data, null, 2)` as text content on success

## ESLint

- Uses flat config (`eslint.config.mjs`) with typescript-eslint + Nx module boundary enforcement
- Empty interfaces should be `type X = Record<string, never>` not `interface X {}`
- No unused imports -- remove them, don't comment them out
- The `@nx/enforce-module-boundaries` rule prevents invalid cross-package imports

## Nx

- Lint and test targets are **inferred** by `@nx/eslint/plugin` and `@nx/vite/plugin` -- do NOT add them to `project.json`
- Build and serve targets are explicit in `project.json`
- Nx Cloud is enabled for remote caching
- NX AI is disabled (`"nxAI": false`)

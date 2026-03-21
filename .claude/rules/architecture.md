---
description: Core architecture rules for the REAPER MCP Server project
paths: ["**/*.ts", "**/*.lua", "**/*.jsfx"]
---

# Architecture Rules

## Communication Pattern

This project uses **file-based JSON IPC** between the TypeScript MCP server and a Lua bridge running inside REAPER DAW. This is NOT a design choice that can be changed -- REAPER's Lua scripting environment is sandboxed with no sockets, HTTP, or stdin/stdout.

The flow is always:
1. MCP Server writes `command_{uuid}.json` to bridge directory
2. Lua bridge reads command, executes ReaScript API, writes `response_{uuid}.json`
3. MCP Server polls for response and returns to client

Never attempt to use WebSockets, HTTP, or any other transport between the server and REAPER.

## Monorepo Structure

- `apps/` contains runnable applications (currently just `reaper-mcp-server`)
- `libs/` contains shared libraries (currently just `protocol`)
- `reaper/` contains files that get installed INTO REAPER (Lua scripts, JSFX plugins)
- The protocol library is the shared contract between server and bridge -- types here must match the Lua implementation

## Dependency Direction

- `apps/reaper-mcp-server` -> `libs/protocol` (allowed)
- `libs/protocol` -> nothing (no app dependencies, no external deps)
- Never import from `apps/` into `libs/`
- The `reaper/` directory is not a TypeScript package -- it contains Lua/JSFX files

## Bridge Directory

All IPC files go to `{REAPER_RESOURCE_PATH}/Scripts/mcp_bridge_data/`. This path is OS-dependent and auto-detected. The `REAPER_RESOURCE_PATH` env var overrides it.

## Spectrum Analysis

FFT data flows through JSFX gmem shared memory, NOT through JSON files. The JSFX analyzer writes to `gmem[]` and the Lua bridge reads it directly. This avoids the latency of file I/O for high-frequency audio data.

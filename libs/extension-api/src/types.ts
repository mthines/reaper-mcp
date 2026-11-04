import type { z } from 'zod/v4';
import type { CommandType } from '@reaper-mcp/protocol';

/** What the bridge answered, as `sendCommand()` returns it. */
export interface BridgeResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

/** What an MCP tool hands back to the agent. */
export interface ToolResult {
  [key: string]: unknown;
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export type ToolShape = Record<string, z.ZodType>;

/** Where one FX lives: track index (0-based, -1 = master) and its slot in that track's chain. */
export interface FxLocation {
  trackIndex: number;
  fxIndex: number;
}

/** A VST3 plugin's saved state as REAPER keeps it. `state` is what the plugin itself wrote (plus REAPER's 16-byte prefix). */
export interface FxState {
  /** The FX's name as REAPER lists it, e.g. `VST3i: Vital (Vital Audio)`. */
  name: string;
  format: 'vst3';
  header: Uint8Array;
  state: Uint8Array;
}

export interface FxStateClient {
  /** Read the state of one VST3. Other formats are refused with a message. */
  get(loc: FxLocation): Promise<Result<FxState>>;
  /**
   * Replace the state of one VST3 and make REAPER reload it. Both VST3 length fields are fixed for you, the
   * current state is checked first, and with `expectName` a wrong FX index changes nothing.
   */
  set(loc: FxLocation, state: Uint8Array, opts?: { expectName?: string }): Promise<Result<{ name: string }>>;
}

/**
 * Everything an extension may touch. It is handed to `register(api)` and is the whole contract: an extension
 * imports types from this package and nothing from reaper-mcp's own source.
 */
export interface ExtensionApi {
  readonly name: string;
  readonly apiVersion: number;
  /** zod, so an extension does not need its own copy to describe tool inputs. Use `z.coerce.number()` for numbers. */
  readonly z: typeof z;

  /**
   * Register an MCP tool. It is exposed as `<extension name>_<name>` and refused when that name is taken.
   * The handler gets the validated arguments and returns `reply()`, `json()` or `error()`.
   */
  tool<S extends ToolShape>(
    name: string,
    description: string,
    shape: S,
    handler: (args: z.output<z.ZodObject<S>>) => Promise<ToolResult> | ToolResult,
  ): void;

  /** Run one of reaper-mcp's own bridge commands. */
  bridge(command: CommandType, params?: Record<string, unknown>, timeoutMs?: number): Promise<BridgeResult>;
  /** Run a handler from this extension's Lua file (`manifest.lua`). `params` must be JSON-serialisable. */
  call(command: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<BridgeResult>;
  /** Read and write plugin state, see `FxStateClient`. */
  readonly fxState: FxStateClient;

  /** A bridge answer as a tool result: its data as JSON, or `Error: <message>` when it failed. */
  reply(res: BridgeResult): ToolResult;
  json(data: unknown): ToolResult;
  /** A refusal the agent should read: `Error: <message>`, flagged as an error. */
  error(message: string): ToolResult;

  /** Describe the extension's tools in `list_tool_categories` (one category, named after the extension). */
  describeCategory(description: string): void;
}

export interface ExtensionModule {
  register(api: ExtensionApi): void | Promise<void>;
}

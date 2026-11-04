# Extensions

Extensions add tools to reaper-mcp that don't belong in core: support for one synth, one workflow, one studio's habits.
They are **opt-in** (nothing loads unless installed), live outside the server bundle, and see reaper-mcp only through
a small, versioned API.

```bash
reaper-mcp extension list
reaper-mcp extension add vital              # an extension in this clone's extensions/ folder (linked, stays in step with git pull)
reaper-mcp extension add ./my-extension     # a folder (copied)
reaper-mcp extension add https://github.com/someone/their-extension.git   # asks first: it runs as code on your machine
reaper-mcp extension link ./my-extension    # use a working copy live
reaper-mcp extension remove vital           # a linked folder itself is never deleted
reaper-mcp extension new my-synth           # scaffold one
reaper-mcp doctor                           # an Extensions section: manifest valid, entry and Lua files present
```

Extensions install into `~/.reaper-mcp/extensions/<name>/` (`REAPER_MCP_EXTENSIONS` overrides). The MCP server loads them at
start, so **restart it (or the Claude Code session) after adding one**. An extension that is broken, built for another API
version or throws in `register()` is skipped with a reason on stderr; it never stops `serve`.

## Anatomy

```
my-synth/
  reaper-mcp-extension.json   manifest
  index.mjs                   ES module: export default { register(api) { … } }
  handlers.lua                optional: Lua commands that run inside REAPER (api.call)
```

```json
{ "name": "my-synth", "version": "0.1.0", "apiVersion": 1, "description": "…", "main": "index.mjs", "lua": "handlers.lua" }
```

`name` is 2-32 characters (lowercase, digits, dashes) and must equal the folder name; every tool is exposed as
`<name>_<tool>` (dashes become underscores). `main` and `lua` are paths inside the folder (no `..`, no symlinks out of it).

```js
export default {
  register(api) {
    const { z } = api;
    api.tool('hello', 'Say hello and read the project', { name: z.string().optional() }, async ({ name }) => {
      const info = await api.bridge('get_project_info');
      return info.success ? api.json({ hello: name ?? 'world', project: info.data }) : api.error(info.error);
    });
    api.describeCategory('One sentence for list_tool_categories');
  },
};
```

## The API (version 1, `libs/extension-api`)

| Member | What it does |
|---|---|
| `api.tool(name, description, zodShape, handler)` | Register an MCP tool as `<ext>_<name>`. A thrown error becomes an `Error:` result. Use `z.coerce.number()` for numbers. |
| `api.bridge(command, params?, timeoutMs?)` | Run any of reaper-mcp's own bridge commands (`get_track_properties`, `add_fx`, …). |
| `api.call(command, params?, timeoutMs?)` | Run a command from your `handlers.lua`. `params` must be JSON. |
| `api.fxState.get({trackIndex, fxIndex})` / `.set(loc, state, {expectName})` | Read and replace a **VST3** plugin's saved state. |
| `api.reply(res)` / `api.json(data)` / `api.error(msg)` | Build tool results. |
| `api.describeCategory(text)` | Describe your tools in `list_tool_categories`. |
| `api.z` | zod. |

An extension imports **only** from `@reaper-mcp/extension-api` (types, `validateManifest`, VST3 helpers). In this repo that is
enforced: a project tagged `type:extension` may depend only on `type:extension-api` (`eslint.config.mjs`).

### Lua handlers

```lua
return {
  my_command = function(params, host)       -- host = { reaper, plan, fxstate, json_decode }
    return { ok = true }                    -- or: return nil, "why it was refused"
  end,
}
```

The server copies the file to `<bridge folder>/extensions/<name>/handlers.lua` when it loads the extension, and the bridge
reloads it when its text changes. A crash inside a handler is reported as `Handler error:` (a system fault). The bridge
must have been updated (`reaper-mcp setup`, then restart the bridge script) to know `extension_call`.

### Plugin state (`api.fxState`)

Saved state is megabytes, so it travels as files in the bridge folder, never inside the command JSON. For a VST3, REAPER
keeps a 44-byte header and the state, each with a length it checks. `fxState.set` fixes both lengths for you, gives the FX a
new `FXID` (REAPER keeps the loaded instance and ignores new state otherwise), checks the state REAPER holds is consistent
first, and with `expectName` refuses a wrong FX index. What is *inside* the state (a JUCE bank, JSON, a binary blob) is your
extension's job; see `extensions/vital/src/state.ts`. VST2, AU, CLAP and plugins inside FX containers are not supported yet.

## Trust

An extension is code: TypeScript running as your user inside the MCP server, and Lua inside REAPER. `extension add <git-url>`
shows the source folder and asks first; read it. The manifest declares no permissions because none would be enforced.
Extension tools are not in the Claude Code allow-list `reaper-mcp init` writes, so Claude Code asks before each new one.

## Writing and testing one

- In this repo: `extensions/<name>/` (a pnpm workspace package, tag `type:extension`), built by `pnpm nx build <name>` to
  `dist/index.mjs` with esbuild (`extensions/vital/project.json` is the template). `reaper-mcp extension add <name>` links it.
- Test behaviour, not wiring: drive your tools through a fake `ExtensionApi` (`extensions/vital/src/__fixtures__/fake-api.ts`)
  and assert what the agent gets and what state REAPER ends up with. Mock only REAPER.
- Keep logic in pure functions (parse, edit, build) and unit-test them with real fixtures.

## The Vital extension

`extensions/vital` edits a Vital patch through its saved state (the same JSON as a `.vital` file):

| Tool | |
|---|---|
| `vital_read_patch` | Oscillators with wavetable names and frame counts, filters, LFOs, effects on, every mod route with its amount; raw values of settings matching a substring |
| `vital_write_patch` | Settings by Vital's names, mod-matrix routes (add / update / remove), LFO shapes; validated as one unit, `dryRun` available |
| `vital_set_wavetable` | 1-256 frames from classic shapes or additive harmonic recipes, morphing across the position axis |

Not yet: wavetables from audio files, spectral/warp components, the sample slot, effect-section helpers, macros.
Lessons from building it (VST3 length fields, FXID) are in LoreKit under `repo::mthines/reaper-mcp`.

## Not built yet

- A separate collection repo with a `registry.json` (`extension add <name>` would resolve through it). Extensions live in
  `extensions/` until the API is stable; the import boundary above is what keeps splitting them out a `git mv`.
- Allow-listing a vetted extension's tools in `init`.

/**
 * Unit tests for reaper/mcp_extensions_lib.lua (extension_call), run in real Lua 5.4 (wasmoon).
 * Assertions live in the Lua snippets: a failed `assert` rejects the promise.
 */
import { describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LuaFactory } from 'wasmoon';

const LIB_SRC = readFileSync(join(__dirname, '../../../reaper/mcp_extensions_lib.lua'), 'utf8');
const PLAN_SRC = readFileSync(join(__dirname, '../../../reaper/mcp_plan_lib.lua'), 'utf8');

const factory = new LuaFactory();

const PRELUDE = `
function new_ctx(files)
  return { plan = plan, dir = "/bridge/extensions/", fxstate = { marker = true }, read = function(p) return files[p] end }
end
local reaper_stub = { marker = "api" }
function call(files, params) return ext.call(reaper_stub, params, new_ctx(files)) end
`;

async function runLua(snippet: string): Promise<void> {
  const lua = await factory.createEngine();
  try {
    lua.global.set('LIB_SRC', LIB_SRC);
    lua.global.set('PLAN_SRC', PLAN_SRC);
    await lua.doString(
      `ext = load(LIB_SRC, "mcp_extensions_lib.lua")()\nplan = load(PLAN_SRC, "mcp_plan_lib.lua")()\n${PRELUDE}\n${snippet}`,
    );
  } finally {
    lua.global.close();
  }
}

describe('mcp_extensions_lib.lua (wasmoon)', () => {
  it('runs the named command from the extension\'s handlers with decoded params and the host handles', async () => {
    await runLua(`
      local files = { ["/bridge/extensions/demo/handlers.lua"] = [[
        return {
          echo = function(params, host)
            return { n = params.n, nested = params.list[2], api = host.reaper.marker, fx = host.fxstate.marker, plan = host.plan ~= nil }
          end,
        }
      ]] }
      local r, err = call(files, { extension = "demo", command = "echo", paramsJson = '{"n": 3, "list": ["a", "b"]}' })
      assert(r, tostring(err))
      assert(r.n == 3 and r.nested == "b" and r.api == "api" and r.fx == true and r.plan == true)
    `);
  });

  it('passes a handler\'s own refusal through as an error', async () => {
    await runLua(`
      local files = { ["/bridge/extensions/demo/handlers.lua"] = [[ return { no = function() return nil, "not today" end } ]] }
      local r, err = call(files, { extension = "demo", command = "no" })
      assert(r == nil and err == "not today")
    `);
  });

  it('reloads a handlers file when its text changes', async () => {
    await runLua(`
      local files = { ["/bridge/extensions/demo/handlers.lua"] = [[ return { v = function() return { v = 1 } end } ]] }
      assert(call(files, { extension = "demo", command = "v" }).v == 1)
      files["/bridge/extensions/demo/handlers.lua"] = [[ return { v = function() return { v = 2 } end } ]]
      assert(call(files, { extension = "demo", command = "v" }).v == 2)
    `);
  });

  it('refuses names that could reach outside the extension folder', async () => {
    await runLua(`
      local files = {}
      for _, name in ipairs({ "../x", "a/b", "A", "", "x", "demo.lua", 5 }) do
        local r, err = call(files, { extension = name, command = "go" })
        assert(r == nil and err:find("invalid extension name", 1, true), tostring(name) .. ": " .. tostring(err))
      end
      for _, command in ipairs({ "a.b", "a b", "", "1x", "../x", 5 }) do
        local r, err = call(files, { extension = "demo", command = command })
        assert(r == nil and err:find("invalid command name", 1, true), tostring(command) .. ": " .. tostring(err))
      end
    `);
  });

  it('says what is wrong when the file is missing, broken, returns no table, or lacks the command, or the JSON is bad', async () => {
    await runLua(`
      local path = "/bridge/extensions/demo/handlers.lua"
      local function says(files, params, needle)
        local r, err = call(files, params)
        assert(r == nil and err:find(needle, 1, true), needle .. " <- " .. tostring(err))
      end
      says({}, { extension = "demo", command = "go" }, "no Lua handlers installed")
      says({ [path] = "return {" }, { extension = "demo", command = "go" }, "does not compile")
      says({ [path] = "error('boom')" }, { extension = "demo", command = "go" }, "failed to load")
      says({ [path] = "return 5" }, { extension = "demo", command = "go" }, "must return a table")
      says({ [path] = "return {}" }, { extension = "demo", command = "go" }, "no Lua command 'go'")
      says({ [path] = "return { go = function() end }" }, { extension = "demo", command = "go", paramsJson = "{oops" }, "not valid JSON")
    `);
  });
});

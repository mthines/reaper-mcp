/**
 * How to install the Python sidecar, for errors an agent passes on to the user. The CLI on PATH
 * (linked by scripts/install.sh), never `node dist/...`: that path is relative to the clone, and
 * Claude Code usually runs from the user's song folder, where it does not exist.
 */
export const SETUP_SIDECAR_COMMAND = 'reaper-mcp setup-sidecar';

export const SETUP_SIDECAR_HINT = `Run in a terminal: ${SETUP_SIDECAR_COMMAND}`;

/**
 * What a tool answers when the sidecar is not installed. Written for the agent first: what is wrong (and that
 * nothing else is), who fixes it (the user, in a terminal: an agent cannot, and a retry cannot help), and what
 * still works. It keeps the phrase "Audio understanding sidecar not installed", which `classifySidecarError`
 * and `toolErrorCause` recognise. `command` is the exact line to run (a tool that needs less than the default
 * install names its own flags).
 */
export function sidecarNotInstalledMessage(command: string = SETUP_SIDECAR_COMMAND): string {
  return (
    'Audio understanding sidecar not installed. This tool needs the optional Python sidecar; REAPER and the bridge are fine. ' +
    `Tell the user to run this in a terminal, then retry: ${command}. ` +
    "Do not retry before then or try to install it yourself; tools that don't analyse audio keep working."
  );
}

export const SIDECAR_NOT_INSTALLED_MSG = sidecarNotInstalledMessage();

/**
 * The same news in one line, for the bridge page's log (its errors are cut at 300 characters, and the page
 * shows the command as a fix). The page matches `SIDECAR_MISSING_LOG` to offer it, so keep the two in step
 * (`isSidecarMissing` in apps/bridge-ui/src/lib/sidecar.ts).
 */
export const SIDECAR_MISSING_LOG = `Python sidecar not installed. Run in a terminal: ${SETUP_SIDECAR_COMMAND}`;

/** Whether a tool's error text says the sidecar (or one of its parts) is not installed. */
export function isSidecarMissing(text: string): boolean {
  return /sidecar not installed|needs the Python sidecar|(?:audiobox-aesthetics|Stem separation|chord model|FluidSynth native library)[^.]*(?:is )?not installed/i.test(text);
}

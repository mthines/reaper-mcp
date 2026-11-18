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

/** The start of the one-line log the bridge page turns into a notice; the page matches it (`isSidecarMissing` in apps/bridge-ui/src/lib/sidecar.ts), so keep the two in step. */
const MISSING_LOG_PREFIX = 'Python sidecar not installed. Run in a terminal:';

/**
 * The one-line log for a tool's own "not installed" answer (cut at 300 characters on the page, so short), keeping the install line it names (a part's flag:
 * `--with-separation`, `--with-chords`), so the page installs what that tool needs and not the default.
 */
export function sidecarMissingLog(text: string): string {
  const command = text.match(/reaper-mcp setup-sidecar(?: --[\w-]+)*/)?.[0] ?? SETUP_SIDECAR_COMMAND;
  return `${MISSING_LOG_PREFIX} ${command}`;
}

/** Whether a tool's error text says the sidecar (or one of its parts) is not installed. */
export function isSidecarMissing(text: string): boolean {
  return /sidecar not installed|needs the Python sidecar|(?:audiobox-aesthetics|Stem separation|chord model|FluidSynth native library)[^.]*(?:is )?not installed/i.test(text);
}

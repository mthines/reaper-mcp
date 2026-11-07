/**
 * How to install the Python sidecar, for errors an agent passes on to the user. The CLI on PATH
 * (linked by scripts/install.sh), never `node dist/...`: that path is relative to the clone, and
 * Claude Code usually runs from the user's song folder, where it does not exist.
 */
export const SETUP_SIDECAR_COMMAND = 'reaper-mcp setup-sidecar';

export const SETUP_SIDECAR_HINT = `Run in a terminal: ${SETUP_SIDECAR_COMMAND}`;

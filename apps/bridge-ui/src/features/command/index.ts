// The command palette (⌘K), keyboard shortcuts and the `?` sheet. A component registers a command with
// `useCommand`; rules for what gets a palette entry and what earns a shortcut: .claude/rules/command-palette.md.
// Import from here, never the files.
export { CommandProvider, useCommandPalette } from './CommandProvider.js';
export { CommandPaletteButton } from './CommandPaletteButton.js';
export { useCommand } from './useCommand.js';
export { CHORD_TIMEOUT_MS, formatShortcut, matchChord, normalizeToken } from './shortcut.js';
export type { Command } from './types.js';

import { useCommand } from '../command/index.js';
import type { View } from './Log.js';

/** `g` then a letter: the views, in tab order. Letters are mnemonic: Calls, Tools, Agents (sessions), Plugins, Snapshots */
const GO_KEYS: Record<View, string> = { calls: 'c', tools: 't', sessions: 'a', plugins: 'p', snapshots: 's' };

function GoCommand({ view, label, onView }: { view: View; label: string; onView: (v: View) => void }) {
  useCommand({ id: `go-${view}`, label: `Go to ${label}`, group: 'Go to', shortcut: ['g', GO_KEYS[view]], description: 'view tab', onSelect: () => onView(view) });
  return null;
}

/**
 * The log's commands: the view jumps, search focus and, on Calls, the error filter, pause, copy, clear, stepping
 * through rows and the agent filter. Palette-only unless it is frequent and one key long (rules: .claude/rules/command-palette.md).
 */
export function LogCommands({
  views,
  view,
  onView,
  onFocusSearch,
  errorsOnly,
  onToggleErrors,
  paused,
  onTogglePause,
  canCopy,
  onCopy,
  canClear,
  onClear,
  detailsOpen,
  onStep,
  onCloseDetails,
  hasSpan,
  onClearSpan,
  agents,
  agentFilter,
  onAgent,
}: {
  views: Array<{ key: View; label: string }>;
  view: View;
  onView: (v: View) => void;
  onFocusSearch: () => void;
  errorsOnly: boolean;
  onToggleErrors: () => void;
  paused: boolean;
  onTogglePause: () => void;
  canCopy: boolean;
  onCopy: () => void;
  canClear: boolean;
  onClear: () => void;
  detailsOpen: boolean;
  onStep: (dir: 1 | -1) => void;
  onCloseDetails: () => void;
  hasSpan: boolean;
  onClearSpan: () => void;
  /** Agents with calls in the window, when there is more than one */
  agents: Array<{ id: string; name: string }>;
  agentFilter: string | null;
  onAgent: (id: string | null) => void;
}) {
  const calls = view === 'calls';
  useCommand({ id: 'search-focus', label: 'Search', group: 'Find', shortcut: ['/'], description: 'filter the list focus search box', onSelect: onFocusSearch });
  useCommand({ contextual: true, id: 'calls-errors', label: errorsOnly ? 'Show all calls' : 'Show only errors', group: 'Calls', shortcut: ['f'], description: 'filter failed calls', onSelect: onToggleErrors }, calls);
  useCommand({ contextual: true, id: 'calls-pause', label: paused ? 'Resume the log' : 'Pause the log', group: 'Calls', shortcut: ['p'], description: 'freeze to read', onSelect: onTogglePause }, calls);
  useCommand({ contextual: true, id: 'calls-next', label: 'Next call', group: 'Calls', shortcut: ['j'], description: 'open step down', onSelect: () => onStep(1) }, calls);
  useCommand({ contextual: true, id: 'calls-prev', label: 'Previous call', group: 'Calls', shortcut: ['k'], description: 'open step up', onSelect: () => onStep(-1) }, calls);
  useCommand({ contextual: true, id: 'calls-close', label: 'Close call details', group: 'Calls', hint: 'Esc', onSelect: onCloseDetails }, calls && detailsOpen);
  useCommand({ contextual: true, id: 'calls-copy', label: 'Copy visible rows', group: 'Calls', onSelect: onCopy }, calls && canCopy);
  // Destructive for this page's log (the bridge keeps its history): palette only, never a bare key
  useCommand({ contextual: true, id: 'calls-clear', label: 'Clear the log', group: 'Calls', description: 'the bridge keeps its history', onSelect: onClear }, calls && canClear);
  useCommand({ contextual: true, id: 'timeline-clear-span', label: 'Clear the timeline selection', group: 'Timeline', hint: 'Esc', onSelect: onClearSpan }, hasSpan && view !== 'plugins' && view !== 'snapshots');
  useCommand(
    {
      contextual: true,
      id: 'agent-filter',
      label: 'Filter by agent…',
      group: 'Calls',
      description: 'agent session',
      children: [
        { id: 'agent-all', label: 'All agents', hint: agentFilter === null ? 'current' : undefined, onSelect: () => onAgent(null) },
        ...agents.map((a) => ({ id: `agent-${a.id}`, label: a.name, hint: agentFilter === a.id ? 'current' : undefined, onSelect: () => onAgent(a.id) })),
      ],
    },
    (view === 'calls' || view === 'tools') && agents.length > 0,
  );
  return (
    <>
      {views.map((v) => (
        <GoCommand key={v.key} view={v.key} label={v.label} onView={onView} />
      ))}
    </>
  );
}

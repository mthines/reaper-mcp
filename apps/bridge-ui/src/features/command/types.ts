import type { ReactNode } from 'react';

export interface Command {
  /** Stable and unique: the React key and the registry key */
  id: string;
  label: string;
  /** Searched, never drawn (rows are label-only) */
  description?: string;
  icon?: ReactNode;
  /** Headed group in the palette and the shortcut sheet: Go to, Calls, Snapshots… */
  group?: string;
  /** Belongs to the page the viewer is on (the Snapshots view's commands on Snapshots): listed first, ahead of the rest */
  contextual?: boolean;
  /** Key sequence that runs it: `['g', 'c']`, `['f']`, `['mod+k']` */
  shortcut?: string[];
  /** Shown beside the label for a key the command doesn't own (Shift+1–9 on snapshots) */
  hint?: string;
  /** A leaf action; the palette closes first */
  onSelect?: () => void;
  /** A second level the palette drills into ("Rename snapshot…") */
  children?: Command[];
}

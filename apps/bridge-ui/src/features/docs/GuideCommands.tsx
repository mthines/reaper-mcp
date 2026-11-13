import { useCommand, type Command } from '../command/index.js';
import { groupGuides, type GuideMeta } from './docs.js';

/** Each guide as a palette entry: found by its title or its summary, with its section beside it */
export function guideCommands(guides: GuideMeta[], open: (slug: string) => void): Command[] {
  return groupGuides(guides).flatMap((section) =>
    section.guides.map((g) => ({ id: `guide-${g.slug}`, label: g.title, description: `${g.summary} ${section.title}`, hint: section.title, onSelect: () => open(g.slug) })),
  );
}

/**
 * "Docs…" in the palette: one entry that opens a list of the docs (a search finds them from the top level too).
 * While the list isn't there yet (or can't be had) the entry itself opens `fallback`.
 */
export function GuideCommands({
  guides,
  onOpen,
  fallback,
  contextual,
}: {
  guides: GuideMeta[] | undefined;
  onOpen: (slug: string) => void;
  fallback: () => void;
  contextual?: boolean;
}) {
  useCommand({
    id: 'help-guides',
    label: guides?.length ? 'Docs…' : 'Open the docs',
    group: 'Help',
    contextual,
    description: 'docs how to install videos tutorial help learn guides search',
    onSelect: guides?.length ? undefined : fallback,
    children: guides?.length ? guideCommands(guides, onOpen) : undefined,
  });
  return null;
}

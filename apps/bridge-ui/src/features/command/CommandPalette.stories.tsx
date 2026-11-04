import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { CommandProvider, useCommand, useCommandPalette } from './index.js';

/** A page with a few commands of each kind, and a line that says which one ran */
export function Harness() {
  const [ran, setRan] = useState('nothing yet');
  const palette = useCommandPalette();
  useCommand({ id: 'go-calls', label: 'Go to Calls', group: 'Go to', shortcut: ['g', 'c'], onSelect: () => setRan('Go to Calls') });
  useCommand({ id: 'go-snapshots', label: 'Go to Snapshots', group: 'Go to', shortcut: ['g', 's'], onSelect: () => setRan('Go to Snapshots') });
  useCommand({ id: 'errors', label: 'Show only errors', group: 'Calls', shortcut: ['f'], onSelect: () => setRan('Show only errors') });
  useCommand({ id: 'clear', label: 'Clear the log', group: 'Calls', description: 'the bridge keeps its history', onSelect: () => setRan('Clear the log') });
  useCommand({
    id: 'rename',
    label: 'Rename a snapshot…',
    group: 'Snapshots',
    contextual: true,
    children: ['AB-1 balanced', 'AB-2 tight bass'].map((name) => ({ id: `rename-${name}`, label: name, onSelect: () => setRan(`Rename ${name}`) })),
  });
  useCommand({ id: 'help', label: 'Keyboard shortcuts', group: 'Help', shortcut: ['?'], onSelect: () => palette?.setHelpOpen(true) });
  return (
    <div>
      <input aria-label="Filter" placeholder="Filter" />
      <p>
        Ran: <output>{ran}</output>
      </p>
    </div>
  );
}

const meta = {
  title: 'Features/Command/CommandPalette',
  component: Harness,
  decorators: [
    (Story) => (
      <CommandProvider>
        <Story />
      </CommandProvider>
    ),
  ],
} satisfies Meta<typeof Harness>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Press ⌘K (or Ctrl+K) to open the palette, ? for the shortcut sheet, g then c to jump */
export const Default: Story = {};

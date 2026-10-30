import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { EXAMPLE_NOW } from '../../demo/examples.js';
import { exampleFeed } from '../../demo/feed.js';
import type { Session } from '../../lib/sessions.js';
import { LogRows } from './LogRows.js';

const { log, sessions } = exampleFeed();
const today = new Date(EXAMPLE_NOW).setHours(0, 0, 0, 0);
const sessionOf = (id: string): Session => sessions.get(id) ?? { id, first: 0, last: 0, commands: 0, errors: 0 };

const meta = {
  title: 'Features/Log/LogRows',
  component: LogRows,
  args: { rows: log, today, selectedN: log[2]?.n, sessionOf, onSelect: fn() },
  decorators: [(Story) => <div className="log" style={{ height: 420, display: 'flex', flexDirection: 'column' }}><Story /></div>],
} satisfies Meta<typeof LogRows>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The windowed call list: only the rows in view are rendered; one agent per row tag */
export const Default: Story = {};

export const Playground: Story = {};

export const OneAgent: Story = { render: (args) => <LogRows {...args} sessionOf={null} /> };

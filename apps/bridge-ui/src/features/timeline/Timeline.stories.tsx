import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { EXAMPLE_NOW } from '../../demo/examples.js';
import { exampleFeed } from '../../demo/feed.js';
import { RANGES } from './ranges.js';
import { Timeline } from './Timeline.js';

const { history, longHistory } = exampleFeed();

const meta = {
  title: 'Features/Timeline',
  component: Timeline,
  args: { history, longHistory, now: EXAMPLE_NOW, rangeKey: '1h', selection: null, clearedAt: 0, onRange: fn(), onSelect: fn() },
  argTypes: { rangeKey: { control: 'select', options: RANGES.map((r) => r.key) } },
} satisfies Meta<typeof Timeline>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Calls per bar, errors and slow calls stacked on top; drag across bars to filter the log to a span */
export const Default: Story = {};

export const Playground: Story = {};

export const PastWeek: Story = { args: { rangeKey: '7d' } };

export const WithASelection: Story = { args: { selection: { start: EXAMPLE_NOW - 20 * 60_000, end: EXAMPLE_NOW - 10 * 60_000 } } };

export const ClearedHalfAnHourAgo: Story = { args: { clearedAt: EXAMPLE_NOW - 30 * 60_000 } };

export const BeforeAnyHistory: Story = { args: { history: null, longHistory: null } };

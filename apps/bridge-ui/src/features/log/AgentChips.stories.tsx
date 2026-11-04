import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { EXAMPLE_NOW } from '../../demo/examples.js';
import type { Session } from '../../lib/sessions.js';
import { AgentChips } from './AgentChips.js';

// Forty agents, most of them idle: the chips stop at two rows, with "+N more" to open the rest
const ids = Array.from({ length: 40 }, (_, i) => `pid-${4000 - i * 37}`);
const sessionOf = (id: string): Session => ({ id, first: 0, last: EXAMPLE_NOW, commands: 0, errors: 0 });

const meta = {
  title: 'Features/Log/AgentChips',
  component: AgentChips,
  args: { ids, sessionOf, countOf: (id: string) => (id === ids[0] ? 299 : 0), selected: null, now: EXAMPLE_NOW, onPick: fn() },
} satisfies Meta<typeof AgentChips>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const FewAgents: Story = { args: { ids: ids.slice(0, 3) } };
export const Playground: Story = { args: { selected: ids[2] } };

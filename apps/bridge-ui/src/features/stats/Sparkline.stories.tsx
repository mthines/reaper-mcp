import type { Meta, StoryObj } from '@storybook/react-vite';
import { Sparkline } from './Sparkline.js';

const WAVE = Array.from({ length: 60 }, (_, i) => Math.max(0, Math.round(6 + 5 * Math.sin(i / 5) + ((i * 7) % 4))));
const GAPS = WAVE.map((v, i) => (i % 13 < 3 ? null : v));
const ms = (v: number) => `${v.toFixed(0)} ms`;

const meta = {
  title: 'Features/Stats/Sparkline',
  component: Sparkline,
  args: { values: WAVE, floor: 4, tone: 'accent', label: 'Commands per second', format: (v: number) => `${v}/s`, variant: 'line' },
  argTypes: { tone: { control: 'select', options: ['accent', 'bad', 'warn', 'muted'] }, variant: { control: 'select', options: ['line', 'bars'] } },
} satisfies Meta<typeof Sparkline>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="story-row">
      <Sparkline values={WAVE} floor={4} tone="accent" label="Commands" format={(v) => `${v}/s`} />
      <Sparkline values={WAVE.map((v) => (v > 9 ? 1 : 0))} floor={1} tone="bad" label="Errors" format={(v) => `${v}`} variant="bars" />
      <Sparkline values={GAPS} floor={10} tone="warn" label="Latency (gaps: no calls)" format={ms} />
      <Sparkline values={WAVE.map(() => 33)} floor={40} tone="muted" label="Defer loop" format={ms} />
    </div>
  ),
};

export const Playground: Story = {};

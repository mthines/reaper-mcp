import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { DEMO_KNOWLEDGE } from '../../demo/demo-plugins.js';
import { EXAMPLE_NOW } from '../../demo/examples.js';
import { StoryCard } from '../../demo/StoryCard.js';
import { pluginCoverage } from './plugins.js';
import { Plugins } from './index.js';

const rows = pluginCoverage(DEMO_KNOWLEDGE);
const byCoverage = (['learned', 'built-in', 'unknown'] as const).flatMap((c) => rows.filter((r) => r.coverage === c).slice(0, 1));

const meta = {
  title: 'Features/Plugins/PluginDetails',
  component: Plugins.Details,
  args: { row: byCoverage[0], now: EXAMPLE_NOW, onClose: fn(), onContribute: fn(), publish: DEMO_KNOWLEDGE.publish },
  decorators: [(Story) => <div className="story-drawer"><Story /></div>],
} satisfies Meta<typeof Plugins.Details>;
export default meta;
type Story = StoryObj<typeof meta>;

/** One plugin: learned by you, built-in, and unknown */
export const Default: Story = {
  decorators: [],
  render: (args) => (
    <div className="story-stack">
      {byCoverage.map((row) => (
        <StoryCard key={row.coverage} title={row.label} note={row.coverage}>
          <div className="story-drawer">
            <Plugins.Details {...args} row={row} />
          </div>
        </StoryCard>
      ))}
    </div>
  ),
};

export const Playground: Story = {};

import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { EXAMPLE_NOW, SNAPSHOT_EXAMPLES } from '../../demo/examples.js';
import { StoryCard } from '../../demo/StoryCard.js';
import { SnapshotsView } from './SnapshotsView.js';

const [first] = SNAPSHOT_EXAMPLES;
const views = SNAPSHOT_EXAMPLES.filter((x) => !x.saveForm);

const meta = {
  title: 'Features/Snapshots/SnapshotsView',
  component: SnapshotsView,
  args: { feed: first.feed, request: null, blocked: null, now: EXAMPLE_NOW, keys: false, onSend: fn() },
  argTypes: { blocked: { control: 'text' }, query: { control: 'text' } },
  decorators: [(Story) => <div style={{ height: 520, display: 'flex', flexDirection: 'column' }}><Story /></div>],
} satisfies Meta<typeof SnapshotsView>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The project's snapshots in every request state: loading, loaded, refused, lost, read-only, empty */
export const Default: Story = {
  decorators: [],
  render: (args) => (
    <div className="story-stack">
      {views.map((x) => (
        <StoryCard key={x.title} title={x.title} note={x.note}>
          <div className={x.narrow ? 'story-narrow' : undefined}>
            <SnapshotsView {...args} feed={x.feed} request={x.request} blocked={x.blocked} initialRow={x.row} />
          </div>
        </StoryCard>
      ))}
    </div>
  ),
};

export const Playground: Story = {};

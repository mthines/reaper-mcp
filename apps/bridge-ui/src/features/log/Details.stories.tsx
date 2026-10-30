import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { DRAWER_EXAMPLES, EXAMPLE_NOW } from '../../demo/examples.js';
import { StoryCard } from '../../demo/StoryCard.js';
import type { Session } from '../../lib/sessions.js';
import { Log } from './index.js';

const SESSION: Session = { id: 'story', dir: '/Users/you/Music/midnight-drive', client: 'claude-code', first: EXAMPLE_NOW - 3_600_000, last: EXAMPLE_NOW, commands: 214, errors: 3, label: 'midnight-drive' };
const [first] = DRAWER_EXAMPLES;

const meta = {
  title: 'Features/Log/Details',
  component: Log.Details,
  args: {
    entry: first.entry,
    history: first.history,
    session: SESSION,
    now: EXAMPLE_NOW,
    filtered: false,
    onFilter: fn(),
    onAddTerm: fn(),
    onClose: fn(),
    onPick: fn(),
  },
  decorators: [(Story) => <div className="story-drawer"><Story /></div>],
} satisfies Meta<typeof Log.Details>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The drawer for one call: every example, from a measurement to a refused request and a system error */
export const Default: Story = {
  decorators: [],
  render: (args) => (
    <div className="story-stack">
      {DRAWER_EXAMPLES.map((x) => (
        <StoryCard key={x.title} title={x.title} note={x.note}>
          <div className="story-drawer">
            <Log.Details {...args} entry={x.entry} history={x.history} />
          </div>
        </StoryCard>
      ))}
    </div>
  ),
};

export const Playground: Story = {};

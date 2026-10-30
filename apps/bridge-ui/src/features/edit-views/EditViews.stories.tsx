import type { Meta, StoryObj } from '@storybook/react-vite';
import { EDIT_EXAMPLES } from '../../demo/examples.js';
import { StoryCard } from '../../demo/StoryCard.js';
import { EditViewSection } from './EditViews.js';

const meta = {
  title: 'Features/Edit views/EditViewSection',
  component: EditViewSection,
  args: { entry: EDIT_EXAMPLES[0].entry },
} satisfies Meta<typeof EditViewSection>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Every write and listing the drawer draws, as the drawer draws it: "Change" for a write, "Result" for a listing */
export const Default: Story = {
  render: () => (
    <div className="story-stack">
      {EDIT_EXAMPLES.map((x) => (
        <StoryCard key={x.title} title={x.title} note={x.note}>
          <code className="mono-note">{x.entry.c}</code>
          <EditViewSection entry={x.entry} />
        </StoryCard>
      ))}
    </div>
  ),
};

export const Playground: Story = {};

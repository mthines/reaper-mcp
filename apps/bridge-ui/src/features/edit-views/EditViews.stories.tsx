import type { Meta, StoryObj } from '@storybook/react-vite';
import { EDIT_EXAMPLES } from '../../demo/examples.js';
import { StoryCard } from '../../demo/StoryCard.js';
import { EditView } from './index.js';

const meta = {
  title: 'Features/Edit views/EditViewSection',
  component: EditView.Section,
  args: { entry: EDIT_EXAMPLES[0].entry },
} satisfies Meta<typeof EditView.Section>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Every write and listing the drawer draws, as the drawer draws it: "Change" for a write, "Result" for a listing */
export const Default: Story = {
  render: () => (
    <div className="story-stack">
      {EDIT_EXAMPLES.map((x) => (
        <StoryCard key={x.title} title={x.title} note={x.note}>
          <code>{x.entry.c}</code>
          <EditView.Section entry={x.entry} />
        </StoryCard>
      ))}
    </div>
  ),
};

export const Playground: Story = {};
